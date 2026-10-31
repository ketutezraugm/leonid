import type { PayPalClient } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';
import { fromPayPalMoney } from '../paypal/money.js';
import { createOrder, getOrder, payerIdOf } from '../paypal/orders.js';
import { captureApprovedOrder, chargeVaultedWallet, type Charge } from '../paypal/spend.js';
import { deletePaymentToken } from '../paypal/vault.js';
import type { ApprovalRecord, ApprovalStatus, ApprovalsPort, AuditPort, CheckSpend, ReferencePort, Spend, WalletPort } from './ports.js';

// The only path to PayPal's money-moving calls. Every spend goes: rules check -> audit row -> pay.
//   allow          -> charge the saved wallet (automatic payment, F13)
//   needs_approval -> create a PayPal order; the treasurer approves it in the PayPal popup; we capture it (F14)
// Invariants (AGENTS.md): rules are code, the kill switch is PayPal-enforced, and with no wallet there is no fallback payment path.
// The kill switch stops every agent spend, including the approval path: with no active wallet nothing reaches the treasurer.

export type SpendOutcome =
  | { status: 'paid'; orderId: string; captureId?: string }
  | { status: 'needs_approval'; approvalId: string; paypalOrderId: string; reasons: string[] }
  | { status: 'blocked'; reasons: string[] }
  | { status: 'refused'; reason: RefusedReason }
  // Safe to retry with the same referenceId, except a capture mismatch (needs a human). retryable: PayPal answered 5xx or
  // 429, so trying again later may well succeed.
  | { status: 'failed'; detail: string; retryable?: true };

// already_paid and in_progress come from captureApproved when another caller (the browser, or the PayPal webhook) got to
// the approval first: the spend is paid, or its capture is running right now. Neither means anything went wrong.
// payer_mismatch: the order was approved by a PayPal account other than the one the caller required (see CaptureOptions).
export type RefusedReason =
  | 'no_wallet'
  | 'paypal_refused'
  | 'not_approved'
  | 'reference_reused'
  | 'already_paid'
  | 'in_progress'
  | 'payer_mismatch';

export interface CaptureOptions {
  // Capture only if this PayPal payer id approved the order. The unattended webhook path sets it to the treasurer's
  // payer id; the browser path is already behind the treasurer guard and leaves it unset.
  requirePayerId?: string;
}

const failedFrom = (err: PayPalApiError): SpendOutcome =>
  err.status >= 500 || err.status === 429 ? { status: 'failed', detail: err.message, retryable: true } : { status: 'failed', detail: err.message };

export interface ExecutorDeps {
  client: PayPalClient; // the Procurement app's client
  check: CheckSpend;
  audit: AuditPort;
  wallet: WalletPort;
  approvals: ApprovalsPort;
  references: ReferencePort;
}

// Every field that gives a spend its meaning or changes its rules outcome. Free-text `reason` is left out on purpose,
// so a retry may reword it.
const fingerprintOf = (s: Spend) =>
  JSON.stringify([s.amountMinor, s.currency, s.vendor ?? null, s.category ?? null, s.actor, s.kind ?? null, s.payee ?? null, s.fundedBySponsorId ?? null]);

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Free text from a person, made safe for a one-line audit entry: control and format characters (newlines, tabs, bidi
// overrides, zero-width marks) and line separators become spaces, so it cannot forge or hide audit lines.
const oneLine = (text: string) => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();

export function createExecutor(deps: ExecutorDeps) {
  const { client, check, audit, wallet, approvals, references } = deps;

  // The funds gate reads committed spend from audit rows, so a check and the row it writes must not overlap with another
  // check, or two carts could each see the same dollars free. One server process, so a promise chain is enough.
  let lastCheck: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(step: () => Promise<T>): Promise<T> => {
    const turn = lastCheck.then(step, step);
    lastCheck = turn;
    return turn;
  };

  // Turn PayPal's answer into an outcome. Never records "paid" for money we did not ask for.
  async function settle(spend: Spend, auditId: string, charge: Charge): Promise<SpendOutcome> {
    if (charge.status !== 'COMPLETED') {
      await audit.update(auditId, { outcome: 'failed', paypalId: charge.orderId, detail: `capture ${charge.status}` });
      return { status: 'failed', detail: `capture ${charge.status}` };
    }
    if (charge.amount?.amountMinor !== spend.amountMinor || charge.amount.currency !== spend.currency) {
      const got = charge.amount ? `${charge.amount.amountMinor} ${charge.amount.currency}` : 'no amount';
      await audit.update(auditId, {
        outcome: 'mismatch',
        paypalId: charge.captureId ?? charge.orderId,
        detail: `asked ${spend.amountMinor} ${spend.currency}, PayPal captured ${got}`,
      });
      return { status: 'failed', detail: 'captured amount does not match the spend; needs a human to review' };
    }
    await audit.update(auditId, { outcome: 'paid', paypalId: charge.captureId ?? charge.orderId });
    return { status: 'paid', orderId: charge.orderId, captureId: charge.captureId };
  }

  async function pay(spend: Spend, auditId: string): Promise<SpendOutcome> {
    const active = await wallet.getActive();
    if (!active) {
      await audit.update(auditId, { outcome: 'refused', detail: 'no active agent wallet' });
      return { status: 'refused', reason: 'no_wallet' };
    }
    try {
      return await settle(
        spend,
        auditId,
        await chargeVaultedWallet(client, {
          referenceId: spend.referenceId,
          paymentTokenId: active.paymentTokenId,
          amountMinor: spend.amountMinor,
          currency: spend.currency,
        }),
      );
    } catch (err) {
      if (err instanceof PayPalApiError && err.status === 403) {
        // PayPal refused: the payment token is gone (kill switch). Make our own state agree and never try another path.
        await wallet.markRevoked();
        await audit.update(auditId, { outcome: 'refused', detail: err.message });
        return { status: 'refused', reason: 'paypal_refused' };
      }
      await audit.update(auditId, { outcome: 'error', detail: messageOf(err) });
      if (err instanceof PayPalApiError) return { status: 'failed', detail: err.message };
      throw err;
    }
  }

  // What an approval already made for this spend means for a retry of it. null: the approval is pending but its PayPal
  // order was never created (PayPal failed), so the retry carries on and reuses the row.
  function retryOutcome(existing: ApprovalRecord): SpendOutcome | null {
    const orderId = existing.paypalOrderId;
    if (existing.status === 'pending') {
      return orderId ? { status: 'needs_approval', approvalId: existing.id, paypalOrderId: orderId, reasons: existing.reasons } : null;
    }
    if (existing.status === 'paid' && orderId) return { status: 'paid', orderId };
    return lostClaim(existing.status);
  }

  async function requestSpend(spend: Spend): Promise<SpendOutcome> {
    // One reference id = one spend. Reusing it for something else is refused before any rules check or PayPal call.
    const claim = await references.claim(spend.referenceId, fingerprintOf(spend));
    if (claim === 'conflict') {
      const rejectedId = await audit.record({ actor: spend.actor, action: 'spend.rejected', input: spend, reason: spend.reason });
      await audit.update(rejectedId, { outcome: 'refused', detail: `referenceId ${spend.referenceId} is already used for a different spend` });
      return { status: 'refused', reason: 'reference_reused' };
    }
    // A retry of a spend that already reached the treasurer answers with that approval instead of making a second one
    // for the same PayPal order.
    const existing = claim === 'same' ? await approvals.findByReference(spend.referenceId) : null;
    const replay = existing && retryOutcome(existing);
    if (existing && replay) {
      const retryId = await audit.record({ actor: spend.actor, action: 'spend.retry', input: spend, reason: spend.reason });
      await audit.update(retryId, { outcome: replay.status, paypalId: existing.paypalOrderId, detail: `same spend as approval ${existing.id} (${existing.status})` });
      return replay;
    }
    const { result, auditId } = await inTurn(async () => {
      const result = await check(spend);
      const auditId = await audit.record({
        actor: spend.actor,
        action: 'spend.check',
        input: spend,
        reason: spend.reason,
        ruleResult: result,
      });
      return { result, auditId };
    });
    if (result.decision === 'block') {
      await audit.update(auditId, { outcome: 'blocked', detail: result.reasons.join('; ') });
      return { status: 'blocked', reasons: result.reasons };
    }
    // Checked before the approval branch too, so a revoked wallet cannot be routed around through the PayPal popup.
    // pay() checks again, in case the wallet is revoked while this request is in flight.
    if (!(await wallet.getActive())) {
      await audit.update(auditId, { outcome: 'refused', detail: 'no active agent wallet' });
      return { status: 'refused', reason: 'no_wallet' };
    }
    if (result.decision === 'needs_approval') {
      const approvalId = existing?.id ?? (await approvals.create(spend, result, auditId));
      try {
        // Creating the order moves no money. The treasurer approves it in the PayPal popup; capture is a separate step.
        const order = await createOrder(client, {
          referenceId: spend.referenceId,
          amountMinor: spend.amountMinor,
          currency: spend.currency,
          description: spend.reason.slice(0, 120),
        });
        await approvals.attachOrder(approvalId, order.id);
        await audit.update(auditId, { outcome: 'needs_approval', paypalId: order.id, detail: approvalId });
        return { status: 'needs_approval', approvalId, paypalOrderId: order.id, reasons: result.reasons };
      } catch (err) {
        await audit.update(auditId, { outcome: 'error', detail: messageOf(err) });
        if (err instanceof PayPalApiError) return { status: 'failed', detail: err.message };
        throw err;
      }
    }
    return pay(spend, auditId);
  }

  // Called after the treasurer approved in the PayPal popup (and by the CHECKOUT.ORDER.APPROVED webhook). We do not trust
  // the browser: PayPal itself must say the order is APPROVED, for exactly the amount we asked for, before anything is
  // captured. The approval is claimed (pending -> capturing) before PayPal is asked, so a concurrent capture or reject of
  // the same approval loses cleanly instead of both proceeding.
  async function captureApproved(approvalId: string, actor: string, options: CaptureOptions = {}): Promise<SpendOutcome> {
    const approval = await approvals.get(approvalId);
    if (!approval?.paypalOrderId) return { status: 'refused', reason: 'not_approved' };
    const lost = lostClaim(approval.status);
    if (lost) return lost;
    const { spend, paypalOrderId } = approval;
    const auditId = await audit.record({ actor, action: 'spend.capture', input: spend, reason: 'treasurer approved in PayPal' });
    // An approval created before the kill switch stays pending, but nothing is captured until a wallet is active again.
    if (!(await wallet.getActive())) {
      await audit.update(auditId, { outcome: 'refused', paypalId: paypalOrderId, detail: 'no active agent wallet' });
      return { status: 'refused', reason: 'no_wallet' };
    }
    if (!(await approvals.claimCapture(approvalId))) {
      const now = (await approvals.get(approvalId))?.status ?? 'missing';
      await audit.update(auditId, { outcome: 'refused', paypalId: paypalOrderId, detail: `approval is ${now}, not pending` });
      return lostClaim(now) ?? { status: 'refused', reason: 'not_approved' };
    }
    // From here we hold the claim. It goes back to pending whenever PayPal did not capture, so the treasurer can retry or
    // reject. It stays 'capturing' only when money may have moved without us seeing PayPal confirm the exact amount.
    let captureSent = false;
    try {
      const order = await getOrder(client, paypalOrderId);
      if (order.status !== 'APPROVED') {
        await approvals.releaseCapture(approvalId);
        await audit.update(auditId, { outcome: 'refused', paypalId: paypalOrderId, detail: `order is ${order.status}, not APPROVED` });
        return { status: 'refused', reason: 'not_approved' };
      }
      const unit = order.purchase_units?.[0]?.amount;
      const asked = unit ? fromPayPalMoney(unit) : undefined;
      if (asked?.amountMinor !== spend.amountMinor || asked.currency !== spend.currency) {
        await approvals.releaseCapture(approvalId);
        await audit.update(auditId, { outcome: 'mismatch', paypalId: paypalOrderId, detail: 'approved order amount differs from the spend' });
        return { status: 'failed', detail: 'approved order amount does not match the spend; needs a human to review' };
      }
      if (options.requirePayerId && payerIdOf(order) !== options.requirePayerId) {
        await approvals.releaseCapture(approvalId);
        await audit.update(auditId, { outcome: 'refused', paypalId: paypalOrderId, detail: 'order was approved by a PayPal account other than the treasurer' });
        return { status: 'refused', reason: 'payer_mismatch' };
      }
      // Checked again right before the capture: the kill switch may have fired while we talked to PayPal. Deleting the
      // vault token (invariant 3) only stops vault charges; a popup-approved order is not tied to that token, so this
      // re-check is what stops it.
      if (!(await wallet.getActive())) {
        await approvals.releaseCapture(approvalId);
        await audit.update(auditId, { outcome: 'refused', paypalId: paypalOrderId, detail: 'no active agent wallet' });
        return { status: 'refused', reason: 'no_wallet' };
      }
      captureSent = true;
      const outcome = await settle(spend, auditId, await captureApprovedOrder(client, { referenceId: spend.referenceId, orderId: paypalOrderId }));
      if (outcome.status === 'paid') await approvals.markPaid(approvalId);
      return outcome;
    } catch (err) {
      await audit.update(auditId, { outcome: 'error', detail: messageOf(err) });
      // A PayPal error response means PayPal did not capture. A dropped connection mid-capture might have, so that one
      // stays 'capturing' (cannot be rejected) until a human or the capture webhook settles it.
      if (err instanceof PayPalApiError || !captureSent) await approvals.releaseCapture(approvalId);
      if (err instanceof PayPalApiError) return failedFrom(err);
      throw err;
    }
  }

  // The outcome for a capture attempt that finds the approval already past 'pending'.
  function lostClaim(status: ApprovalStatus | 'missing'): SpendOutcome | null {
    if (status === 'pending') return null;
    if (status === 'paid') return { status: 'refused', reason: 'already_paid' };
    if (status === 'capturing') return { status: 'refused', reason: 'in_progress' };
    return { status: 'refused', reason: 'not_approved' };
  }

  async function rejectApproval(approvalId: string, actor: string, why?: string): Promise<{ rejected: boolean }> {
    const approval = await approvals.get(approvalId);
    // Conditional on 'pending': a capture that claimed the approval first wins, and the reject is refused.
    if (!approval || !(await approvals.reject(approvalId, actor))) return { rejected: false };
    const note = why && oneLine(why);
    const auditId = await audit.record({ actor, action: 'spend.rejected_by_treasurer', input: approval.spend, reason: note ? `treasurer rejected: ${note}` : 'treasurer rejected' });
    await audit.update(auditId, { outcome: 'rejected', paypalId: approval.paypalOrderId });
    return { rejected: true };
  }

  // The kill switch. Our flag flips first, so spending stops even if the PayPal call fails; PayPal then enforces it.
  // A token stays on the "pending deletion" list until PayPal confirms, so calling this again retries a failed delete.
  async function revokeWallet(actor: string): Promise<{ revoked: boolean }> {
    if (await wallet.getActive()) await wallet.markRevoked();
    const pending = await wallet.pendingDeletions();
    if (pending.length === 0) return { revoked: false };
    const auditId = await audit.record({ actor, action: 'wallet.revoke', input: { tokens: pending.length }, reason: 'kill switch' });
    let failure: unknown;
    for (const tokenId of pending) {
      try {
        await deletePaymentToken(client, tokenId);
      } catch (err) {
        if (!(err instanceof PayPalApiError && err.status === 404)) {
          failure ??= err; // keep going: delete every token we can, report the first failure
          continue;
        }
      }
      await wallet.confirmDeleted(tokenId);
    }
    if (failure) {
      await audit.update(auditId, { outcome: 'error', detail: messageOf(failure) });
      throw failure;
    }
    await audit.update(auditId, { outcome: 'revoked', paypalId: pending.join(',') });
    return { revoked: true };
  }

  return { requestSpend, captureApproved, rejectApproval, revokeWallet };
}
export type Executor = ReturnType<typeof createExecutor>;
