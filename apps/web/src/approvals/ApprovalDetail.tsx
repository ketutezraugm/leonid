import { useEffect, useRef, useState } from 'react';
import type { ApprovalItem } from '@quartermaster/shared';
import { REJECT_REASON_MAX_LENGTH } from '@quartermaster/shared';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';
import { useToast } from '../ui/Toast';
import { captureApproval, rejectApproval } from './capture';
import { loadPayPal } from './paypal-sdk';

// One approval: why the rules sent it to the treasurer, the agent's own reasoning, then the PayPal button.
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
  const [phase, setPhase] = useState<'idle' | 'paying' | 'paid' | 'declined'>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const mount = useRef<HTMLDivElement>(null);

  const canPay = Boolean(clientId && item.paypalOrderId && !walletBlocked && item.status === 'pending');

  useEffect(() => {
    const container = mount.current;
    if (!canPay || !container || !clientId || !item.paypalOrderId || phase === 'paid' || phase === 'declined') return;
    let buttons: { close: () => Promise<void> } | null = null;
    let cancelled = false;
    const orderId = item.paypalOrderId;
    loadPayPal(clientId, item.currency)
      .then(async (paypal) => {
        if (cancelled) return;
        container.replaceChildren();
        const instance = paypal.Buttons({
          style: { layout: 'horizontal', tagline: false, height: 40 },
          createOrder: () => Promise.resolve(orderId),
          onApprove: async () => {
            setPhase('paying');
            const result = await captureApproval(item.id);
            if (result.kind === 'paid') {
              setPhase('paid');
              toast.success(`Paid ${formatMoney(item.amountMinor, item.currency)}.`);
            } else {
              setPhase('idle');
              setFailure(result.message);
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

  const title = item.vendor ?? item.category ?? item.referenceId;

  return (
    <section className="card approval-detail" aria-label={`Approval: ${title}`}>
      <header className="approval-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">Asked by {item.actor}</p>
        </div>
        <span className="approval-amount num">{formatMoney(item.amountMinor, item.currency)}</span>
      </header>

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
      ) : phase === 'declined' ? (
        <p className="approval-result" role="status">
          <StatusBadge status="blocked" label="Declined" /> Nothing was charged.
        </p>
      ) : (
        <div className="approval-actions">
          {walletBlocked && <p className="field-hint">{walletBlocked}</p>}
          {!walletBlocked && !item.paypalOrderId && <p className="field-hint">This item has no PayPal order to approve yet.</p>}
          {!walletBlocked && item.paypalOrderId && !clientId && (
            <p className="field-hint">PayPal approval isn’t configured on this server.</p>
          )}
          {item.status === 'capturing' && (
            <p className="field-hint">A payment is already being captured. Refresh in a moment.</p>
          )}
          <div ref={mount} className="paypal-mount" aria-busy={phase === 'paying'} />
          {phase === 'paying' && <p role="status">Finishing the payment…</p>}
          {failure && (
            <p className="field-error" role="alert">
              {failure}
            </p>
          )}
          <div className="btn-row">
            <Button onClick={() => setDeclining(true)} disabled={phase === 'paying' || item.status !== 'pending'}>
              Decline
            </Button>
            <Button onClick={onResolved}>Refresh</Button>
          </div>
        </div>
      )}

      {(phase === 'paid' || phase === 'declined') && (
        <div className="btn-row">
          <Button variant="primary" onClick={onResolved}>
            Next approval
          </Button>
        </div>
      )}

      {declining && (
        <ConfirmDialog
          title="Decline this spend?"
          confirmLabel="Decline"
          busyLabel="Declining…"
          danger
          busy={busy}
          onConfirm={() => void decline()}
          onCancel={() => setDeclining(false)}
        >
          <p>The agent won’t buy this. You can add a reason for the audit log.</p>
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
