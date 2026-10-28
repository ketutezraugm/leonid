import { PayPalApiError } from '../paypal/errors.js';
import type { PayPalClient } from '../paypal/client.js';
import { chargeVaultedWallet } from '../paypal/spend.js';
import { deletePaymentToken } from '../paypal/vault.js';
import type { ApprovalsPort, AuditPort, CheckSpend, ReferencePort, Spend, WalletPort } from './ports.js';

// The only path to PayPal's money-moving calls. Every spend goes: rules check -> audit row -> (approval) -> charge.
// Invariants (AGENTS.md): rules are code, the kill switch is PayPal-enforced, and with no wallet there is no fallback payment path.

export type SpendOutcome =
  | { status: 'paid'; orderId: string; captureId?: string }
  | { status: 'needs_approval'; approvalId: string; reasons: string[] }
  | { status: 'blocked'; reasons: string[] }
  | { status: 'refused'; reason: 'no_wallet' | 'paypal_refused' | 'not_approved' | 'reference_reused' }
  | { status: 'failed'; detail: string }; // safe to retry with the same referenceId, except a capture mismatch (needs a human)

export interface ExecutorDeps {
  client: PayPalClient; // the Procurement app's client
  check: CheckSpend;
  audit: AuditPort;
  wallet: WalletPort;
  approvals: ApprovalsPort;
  references: ReferencePort;
}

// Every field that gives a spend its meaning or changes its rules outcome. Free-text `reason` is left out on purpose,
// so a retry may reword it. ponytail: once references live in the DB, also store the PayPal order id per reference and
// check that a 'same' retry resolves to that same order.
const fingerprintOf = (s: Spend) =>
  JSON.stringify([s.amountMinor, s.currency, s.vendor ?? null, s.category ?? null, s.actor]);

export function createExecutor(deps: ExecutorDeps) {
  const { client, check, audit, wallet, approvals, references } = deps;

  async function pay(spend: Spend, auditId: string): Promise<SpendOutcome> {
    const active = await wallet.getActive();
    if (!active) {
      await audit.update(auditId, { outcome: 'refused', detail: 'no active agent wallet' });
      return { status: 'refused', reason: 'no_wallet' };
    }
    try {
      const charge = await chargeVaultedWallet(client, {
        referenceId: spend.referenceId,
        paymentTokenId: active.paymentTokenId,
        amountMinor: spend.amountMinor,
        currency: spend.currency,
      });
      if (charge.status !== 'COMPLETED') {
        await audit.update(auditId, { outcome: 'failed', paypalId: charge.orderId, detail: `capture ${charge.status}` });
        return { status: 'failed', detail: `capture ${charge.status}` };
      }
      // Never record "paid" for money we did not ask for: the captured amount must be exactly the spend.
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
    } catch (err) {
      if (err instanceof PayPalApiError && err.status === 403) {
        // PayPal refused: the payment token is gone (kill switch). Make our own state agree and never try another path.
        await wallet.markRevoked();
        await audit.update(auditId, { outcome: 'refused', detail: err.message });
        return { status: 'refused', reason: 'paypal_refused' };
      }
      await audit.update(auditId, { outcome: 'error', detail: err instanceof Error ? err.message : String(err) });
      if (err instanceof PayPalApiError) return { status: 'failed', detail: err.message };
      throw err;
    }
  }

  async function requestSpend(spend: Spend): Promise<SpendOutcome> {
    // One reference id = one spend. Reusing it for something else is refused before any rules check or PayPal call.
    if ((await references.claim(spend.referenceId, fingerprintOf(spend))) === 'conflict') {
      const rejectedId = await audit.record({
        actor: spend.actor,
        action: 'spend.rejected',
        input: spend,
        reason: spend.reason,
      });
      await audit.update(rejectedId, { outcome: 'refused', detail: `referenceId ${spend.referenceId} is already used for a different spend` });
      return { status: 'refused', reason: 'reference_reused' };
    }
    const result = await check(spend);
    const auditId = await audit.record({
      actor: spend.actor,
      action: 'spend.check',
      input: spend,
      reason: spend.reason,
      ruleResult: result,
    });
    if (result.decision === 'block') {
      await audit.update(auditId, { outcome: 'blocked', detail: result.reasons.join('; ') });
      return { status: 'blocked', reasons: result.reasons };
    }
    if (result.decision === 'needs_approval') {
      const approvalId = await approvals.create(spend, result, auditId);
      await audit.update(auditId, { outcome: 'needs_approval', detail: approvalId });
      return { status: 'needs_approval', approvalId, reasons: result.reasons };
    }
    return pay(spend, auditId);
  }

  // Called after the treasurer approved. Re-running with the same referenceId can never charge twice.
  async function executeApproved(approvalId: string): Promise<SpendOutcome> {
    const approval = await approvals.get(approvalId);
    if (!approval || approval.status !== 'approved' || !approval.decidedBy) {
      return { status: 'refused', reason: 'not_approved' };
    }
    const auditId = await audit.record({
      actor: approval.decidedBy,
      action: 'spend.approved',
      input: approval.spend,
      reason: 'treasurer approved',
    });
    const outcome = await pay(approval.spend, auditId);
    if (outcome.status === 'paid') await approvals.markPaid(approvalId);
    return outcome;
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
      await audit.update(auditId, { outcome: 'error', detail: failure instanceof Error ? failure.message : String(failure) });
      throw failure;
    }
    await audit.update(auditId, { outcome: 'revoked', paypalId: pending.join(',') });
    return { revoked: true };
  }

  return { requestSpend, executeApproved, revokeWallet };
}
export type Executor = ReturnType<typeof createExecutor>;
