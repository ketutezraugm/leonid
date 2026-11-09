import { useEffect, useRef, useState } from 'react';
import type { ApprovalItem } from '@leonid/shared';
import { REJECT_REASON_MAX_LENGTH } from '@leonid/shared';
import { loadPayPalSdk } from '../lib/paypalSdk';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/Toast';
import { approvalTitle, captureApproval, rejectApproval } from './capture';

// One approval: why the rules sent it to the treasurer, the agent's own reasoning, then the PayPal button.
// A payout (a claim or a prize) has no PayPal order and no popup: the screen shows who gets the money and where,
// and the treasurer approves it with a button and a confirm step. The kill switch stops payouts too.
// The agent's three compared options and the money check (unlocked before and after) appear here once P1
// attaches them to the approval item; until then only what the item carries is shown.
export function ApprovalDetail({
  item,
  clientId,
  walletBlocked,
  onResolved,
}: {
  item: ApprovalItem;
  clientId: string | null;
  /** The agent wallet is not active, so approvals are disabled with the reason. */
  walletBlocked: string | null;
  onResolved: () => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<'idle' | 'paying' | 'paid' | 'sent' | 'declined'>('idle');
  const [confirmingPayout, setConfirmingPayout] = useState(false);
  const isPayout = item.kind === 'payout';
  const [failure, setFailure] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const mount = useRef<HTMLDivElement>(null);

  const canPay = Boolean(!isPayout && clientId && item.paypalOrderId && !walletBlocked && item.status === 'pending');
  const canSendPayout = isPayout && !walletBlocked && item.status === 'pending';
  const amount = formatMoney(item.amountMinor, item.currency);

  useEffect(() => {
    const container = mount.current;
    if (!canPay || !container || !clientId || !item.paypalOrderId || phase === 'paid' || phase === 'declined') return;
    let buttons: { close: () => Promise<void> } | null = null;
    let cancelled = false;
    const orderId = item.paypalOrderId;
    loadPayPalSdk(item.currency)
      .then(async (paypal) => {
        if (cancelled) return;
        container.replaceChildren();
        const instance = paypal.Buttons({
          style: { layout: 'horizontal', tagline: false, height: 40 },
          createOrder: () => Promise.resolve(orderId),
          onApprove: async () => {
            setPhase('paying');
            const result = await captureApproval(item.id);
            if (result.kind === 'failed') {
              setPhase('idle');
              setFailure(result.message);
            } else {
              setPhase('paid');
              toast.success(`Paid ${formatMoney(item.amountMinor, item.currency)}.`);
            }
          },
          onCancel: () => setFailure('The PayPal window was closed before you approved. Nothing was charged.'),
          onError: () => setFailure("PayPal couldn't complete the payment. Nothing was charged; try again."),
        });
        buttons = instance;
        await instance.render(container);
      })
      .catch(() => !cancelled && setFailure("PayPal's buttons didn't load. Check your connection, then try again."));
    return () => {
      cancelled = true;
      void buttons?.close().catch(() => undefined);
    };
    // The button is rebuilt only when the item or the ability to pay changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPay, item.id, clientId]);

  async function sendPayout() {
    setConfirmingPayout(false);
    setFailure(null);
    setPhase('paying');
    const result = await captureApproval(item.id);
    if (result.kind === 'failed') {
      setPhase('idle');
      setFailure(result.message);
      return;
    }
    setPhase(result.kind === 'sent' ? 'sent' : 'paid');
    toast.success(`Sent ${amount} to ${recipient}.`);
  }

  async function decline() {
    setBusy(true);
    const ok = await rejectApproval(item.id, reason);
    setBusy(false);
    setDeclining(false);
    if (ok) {
      setPhase('declined');
      toast.success('Declined. The reason is in the audit log.');
    } else {
      toast.error("Couldn't decline this. It may already be paid; refresh the list.");
    }
  }

  const title = approvalTitle(item);
  const recipient = item.payeeEmail ?? item.payee ?? 'the recipient';

  return (
    <section className="card approval-detail" aria-label={`Approval: ${title}`}>
      <header className="approval-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {isPayout ? 'Payout' : 'Purchase'} · asked by {item.actor}
          </p>
        </div>
        <span className="approval-amount num">{formatMoney(item.amountMinor, item.currency)}</span>
      </header>

      {isPayout && (
        <div className="approval-block">
          <h3>Where the money goes</h3>
          <p>
            {item.payee ?? 'No name given'}
            {item.payeeEmail ? (
              <>
                {' '}
                · PayPal <strong>{item.payeeEmail}</strong>
              </>
            ) : (
              ' · no PayPal email'
            )}
          </p>
          <p className="field-hint">Paid from the treasury through PayPal Payouts. There is no PayPal window for a payout.</p>
        </div>
      )}
      <div className="approval-block">
        <h3>Why it needs you</h3>
        <ul>
          {item.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div className="approval-block">
        <h3>The agent’s reasoning</h3>
        <p>{item.agentReason}</p>
      </div>

      {phase === 'paid' ? (
        <p className="approval-result" role="status">
          <StatusBadge status="done" label="Paid" /> The payment went through and the audit log has it.
        </p>
      ) : phase === 'sent' ? (
        <p className="approval-result" role="status">
          <StatusBadge status="progress" label="Sent" /> PayPal accepted the payout to {recipient}. It finishes in a few
          minutes, and the audit log has it.
        </p>
      ) : phase === 'declined' ? (
        <p className="approval-result" role="status">
          <StatusBadge status="blocked" label="Declined" /> Nothing was charged.
        </p>
      ) : (
        <div className="approval-actions">
          {walletBlocked && <p className="field-hint">{walletBlocked}</p>}
          {!isPayout && !walletBlocked && !item.paypalOrderId && (
            <p className="field-hint">This item has no PayPal order to approve yet.</p>
          )}
          {!isPayout && !walletBlocked && item.paypalOrderId && !clientId && (
            <p className="field-hint">PayPal approval isn’t configured on this server.</p>
          )}
          {item.status === 'capturing' && (
            <p className="field-hint">A payment is already being captured. Refresh in a moment.</p>
          )}
          {!isPayout && <div ref={mount} className="paypal-mount" aria-busy={phase === 'paying'} />}
          {phase === 'paying' && <p role="status">{isPayout ? 'Sending the payout…' : 'Finishing the payment…'}</p>}
          {failure && (
            <p className="field-error" role="alert">
              {failure}
            </p>
          )}
          <div className="btn-row">
            {isPayout && (
              <Button
                variant="primary"
                disabled={!canSendPayout || !item.payeeEmail}
                busy={phase === 'paying'}
                busyLabel="Sending…"
                onClick={() => setConfirmingPayout(true)}
              >
                Approve and pay {amount}
              </Button>
            )}
            <Button onClick={() => setDeclining(true)} disabled={phase === 'paying' || item.status !== 'pending'}>
              Decline
            </Button>
            <Button onClick={onResolved}>Refresh</Button>
          </div>
        </div>
      )}

      {(phase === 'paid' || phase === 'sent' || phase === 'declined') && (
        <div className="btn-row">
          <Button variant="primary" onClick={onResolved}>
            Next approval
          </Button>
        </div>
      )}

      {confirmingPayout && (
        <ConfirmDialog
          title={`Pay ${amount} to ${item.payee ?? recipient}?`}
          confirmLabel={`Pay ${amount}`}
          onConfirm={() => void sendPayout()}
          onCancel={() => setConfirmingPayout(false)}
        >
          <p>
            The money goes from the treasury to the PayPal account <strong>{recipient}</strong>. Once PayPal accepts it,
            it can’t be taken back from here.
          </p>
        </ConfirmDialog>
      )}

      {declining && (
        <ConfirmDialog
          title={isPayout ? 'Decline this payout?' : 'Decline this spend?'}
          confirmLabel="Decline"
          busyLabel="Declining…"
          danger
          busy={busy}
          onConfirm={() => void decline()}
          onCancel={() => setDeclining(false)}
        >
          <p>
            {isPayout ? 'This person won’t be paid.' : 'The agent won’t buy this.'} You can add a reason for the audit log.
          </p>
          <Field
            id="decline-reason"
            label="Reason (optional)"
            maxLength={REJECT_REASON_MAX_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </ConfirmDialog>
      )}
    </section>
  );
}
