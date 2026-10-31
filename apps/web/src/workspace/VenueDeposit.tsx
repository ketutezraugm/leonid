import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  SpendOutcome,
  VenueDepositPayResponse,
  VenueDepositResponse,
  type VenueDeposit,
} from '@quartermaster/shared';
import { formatMoney } from '../ui/money';
import { loadPayPalSdk } from '../lib/paypalSdk';
import { rememberReturnPath } from '../shell/returnPath';

type State =
  | { kind: 'idle' }
  | { kind: 'paying' }
  | { kind: 'signin' }
  | { kind: 'outcome'; outcome: SpendOutcome }
  | { kind: 'error'; message: string };

async function errorOf(res: Response): Promise<string> {
  const body = ApiError.safeParse(await res.json().catch(() => null));
  return body.success ? body.data.error : `HTTP ${res.status}`;
}

// The deposit for the venue the organizer picked, paid with PayPal (sandbox). The server reads the
// pick and the amount itself; this panel only asks it to pay and shows what the spending rules did.
export function VenueDepositPanel({ threadId, pickName }: { threadId: string; pickName: string }) {
  const [deposit, setDeposit] = useState<VenueDeposit | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });

  // The pick reaches the server with the chat run that follows it. The workspace remounts this
  // panel for each pick, so it starts empty.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/venue-deposit/${threadId}`)
      .then(async (res) => (res.ok ? VenueDepositResponse.parse(await res.json()) : null))
      .then((body) => !cancelled && setDeposit(body?.deposit ?? null))
      .catch(() => {
        // No deposit to show; the venue pick itself still stands.
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, pickName]);

  if (!deposit) return null;

  async function pay() {
    setState({ kind: 'paying' });
    try {
      const res = await fetch(`/api/venue-deposit/${threadId}`, { method: 'POST' });
      if (res.status === 401) return setState({ kind: 'signin' });
      const body = VenueDepositPayResponse.safeParse(
        await res
          .clone()
          .json()
          .catch(() => null),
      );
      if (body.success) return setState({ kind: 'outcome', outcome: body.data.outcome });
      setState({ kind: 'error', message: await errorOf(res) });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function demoSignIn() {
    const res = await fetch('/api/auth/demo-login', { method: 'POST' });
    if (res.ok) return pay();
    setState({ kind: 'error', message: 'Demo sign-in is off on this server. Log in with PayPal.' });
  }

  async function connectWallet() {
    const res = await fetch('/api/wallet/connect', { method: 'POST' });
    if (!res.ok) return setState({ kind: 'error', message: await errorOf(res) });
    const body = (await res.json().catch(() => null)) as { approveUrl?: unknown } | null;
    const approveUrl = typeof body?.approveUrl === 'string' ? body.approveUrl : '';
    // Only ever leave for PayPal's own sandbox site.
    if (!/^https:\/\/www\.sandbox\.paypal\.com\//.test(approveUrl)) {
      return setState({ kind: 'error', message: 'PayPal did not return a wallet approval link.' });
    }
    // PayPal sends the browser back to the app once the wallet is connected; come back here.
    rememberReturnPath('/agent');
    window.location.assign(approveUrl);
  }

  const amount = formatMoney(deposit.amountMinor, deposit.currency);
  const paid = state.kind === 'outcome' && state.outcome.status === 'paid';

  return (
    <section className={`deposit${paid ? ' is-paid' : ''}`} aria-label="Venue deposit">
      <div className="deposit-head">
        <div>
          <p className="deposit-eyebrow">Next: hold the date</p>
          <h3>
            {amount} deposit for {deposit.venue}
          </h3>
          <p className="muted">
            Paid with PayPal (sandbox). Your spending rules decide: up to $200 is paid from the
            agent&apos;s PayPal wallet, anything more goes to the treasurer to approve.
          </p>
        </div>
        {(state.kind === 'idle' || state.kind === 'error') && (
          <button type="button" className="deposit-pay" onClick={pay}>
            Pay deposit with PayPal
          </button>
        )}
        {state.kind === 'paying' && (
          <span className="deposit-status" role="status">
            Checking the rules…
          </span>
        )}
      </div>

      {state.kind === 'signin' && (
        <div className="deposit-body" role="alert">
          <p>Only the treasurer can move money. Sign in to pay this deposit.</p>
          <div className="deposit-actions">
            <a
              className="deposit-pay"
              href="/api/auth/paypal/login"
              onClick={() => rememberReturnPath('/agent')}
            >
              Log in with PayPal
            </a>
            <button type="button" className="link-button" onClick={demoSignIn}>
              Use the demo sign-in
            </button>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <p className="deposit-body deposit-error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === 'outcome' && (
        <Outcome
          outcome={state.outcome}
          onRetry={pay}
          onConnectWallet={connectWallet}
          onApproved={(outcome) => setState({ kind: 'outcome', outcome })}
        />
      )}
    </section>
  );
}

function Outcome({
  outcome,
  onRetry,
  onConnectWallet,
  onApproved,
}: {
  outcome: SpendOutcome;
  onRetry: () => void;
  onConnectWallet: () => void;
  onApproved: (outcome: SpendOutcome) => void;
}) {
  switch (outcome.status) {
    case 'paid':
      return (
        <p className="deposit-body deposit-paid" role="status">
          Deposit paid with PayPal. PayPal reference{' '}
          <code>{outcome.captureId ?? outcome.orderId}</code>. It is in the audit log.
        </p>
      );
    case 'needs_approval':
      return (
        <div className="deposit-body">
          <p>
            The rules sent this to the treasurer: {outcome.reasons.join('; ')}. Approve it in PayPal
            to pay.
          </p>
          <ApproveButtons
            approvalId={outcome.approvalId}
            orderId={outcome.paypalOrderId}
            onApproved={onApproved}
          />
        </div>
      );
    case 'blocked':
      return (
        <p className="deposit-body deposit-error" role="alert">
          Blocked by the spending rules: {outcome.reasons.join('; ')}.
        </p>
      );
    case 'refused':
      return outcome.reason === 'no_wallet' || outcome.reason === 'paypal_refused' ? (
        <div className="deposit-body" role="alert">
          <p>
            {outcome.reason === 'no_wallet'
              ? 'The agent has no PayPal wallet connected, so nothing can be paid.'
              : 'PayPal refused the charge: the wallet was revoked with the kill switch.'}{' '}
            Connect a sandbox PayPal account to pay deposits.
          </p>
          <div className="deposit-actions">
            <button type="button" className="deposit-pay" onClick={onConnectWallet}>
              Connect the agent&apos;s PayPal wallet
            </button>
          </div>
        </div>
      ) : (
        <p className="deposit-body deposit-error" role="alert">
          Not paid: {outcome.reason.replaceAll('_', ' ')}.
        </p>
      );
    case 'failed':
      return (
        <div className="deposit-body deposit-error" role="alert">
          <p>PayPal did not complete the payment: {outcome.detail}</p>
          {outcome.retryable && (
            <button type="button" className="link-button" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      );
  }
}

// PayPal's own approval popup for the order the server created. On approval the server asks PayPal
// whether the order is approved for the right amount, then captures it.
function ApproveButtons({
  approvalId,
  orderId,
  onApproved,
}: {
  approvalId: string;
  orderId: string;
  onApproved: (outcome: SpendOutcome) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    let buttons: { close(): Promise<void> } | null = null;
    loadPayPalSdk()
      .then((paypal) => {
        if (closed || !container.current) return;
        const rendered = paypal.Buttons({
          style: { layout: 'horizontal', label: 'pay', tagline: 'false' },
          createOrder: () => orderId,
          onApprove: async () => {
            const res = await fetch(`/api/approvals/${approvalId}/capture`, { method: 'POST' });
            const body = SpendOutcome.safeParse(await res.json().catch(() => null));
            if (res.ok && body.success && body.data.status === 'paid') onApproved(body.data);
            else if (body.success && body.data.status === 'refused')
              setError(`Not captured: ${body.data.reason.replaceAll('_', ' ')}`);
            else setError(`Capture failed (HTTP ${res.status})`);
          },
          onError: () => setError('PayPal could not open the approval. Try again.'),
        });
        buttons = rendered;
        return rendered.render(container.current);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      closed = true;
      void buttons?.close().catch(() => undefined);
    };
  }, [approvalId, orderId, onApproved]);

  return (
    <>
      <div ref={container} className="deposit-paypal" />
      {error && (
        <p className="deposit-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
