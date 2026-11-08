import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  SpendOutcome,
  VenueBookingPayResponse,
  VenueBookingResponse,
  type VenueBookingSummary,
} from '@quartermaster/shared';
import { formatMoney } from '../ui/money';
import { loadPayPalSdk } from '../lib/paypalSdk';
import { rememberReturnPath } from '../shell/returnPath';
import { safeLinks } from './venues';

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

// What the agent planned for the picked venue, shown in place of the venue list: the event, the venue, what the
// one-day hire costs and the USD total. The organizer reads it, agrees, and pays it with PayPal (sandbox). The server reads
// the pick, the price and the headcount itself; this panel only asks it to pay and shows what the spending rules did.
export function VenueBookingPanel({
  threadId,
  pickName,
  onBack,
}: {
  threadId: string;
  pickName: string;
  onBack: () => void;
}) {
  const [summary, setSummary] = useState<VenueBookingSummary | null | undefined>(undefined);
  const [agreed, setAgreed] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  // The pick reaches the server with the chat run that follows it. The workspace remounts this
  // panel for each pick, so it starts empty.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/venue-booking/${threadId}`)
      .then(async (res) => (res.ok ? VenueBookingResponse.parse(await res.json()) : null))
      .then((body) => !cancelled && setSummary(body?.summary ?? null))
      .catch(() => !cancelled && setSummary(null));
    return () => {
      cancelled = true;
    };
  }, [threadId, pickName]);

  if (summary === undefined) {
    return (
      <section className="booking" aria-label="Plan status" aria-busy="true">
        <p className="booking-eyebrow">Your plan</p>
        <p className="muted" role="status">
          Preparing your plan…
        </p>
      </section>
    );
  }
  if (!summary) {
    return (
      <section className="booking" aria-label="Plan status">
        <p className="booking-eyebrow">Your plan</p>
        <h3>No plan to pay for yet</h3>
        <p className="muted">
          Only the seeded demo venues, in a chat linked to an event, can be paid for here.
        </p>
        <button type="button" className="link-button" onClick={onBack}>
          Back to venues
        </button>
      </section>
    );
  }

  async function pay() {
    setState({ kind: 'paying' });
    try {
      const res = await fetch(`/api/venue-booking/${threadId}`, { method: 'POST' });
      if (res.status === 401) return setState({ kind: 'signin' });
      const body = VenueBookingPayResponse.safeParse(
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
    rememberReturnPath(window.location.pathname);
    window.location.assign(approveUrl);
  }

  const total = formatMoney(summary.payable.amountMinor, 'USD');
  const paid = state.kind === 'outcome' && state.outcome.status === 'paid';
  const { event, venue, estimate, fx } = summary;
  const [source] = safeLinks([venue.sourceUrl]);
  const canPay = state.kind === 'idle' || state.kind === 'error';

  return (
    <section className={`booking${paid ? ' is-paid' : ''}`} aria-label="Plan summary">
      <p className="booking-eyebrow">Your plan</p>
      <h3>
        {event.name} at {venue.name}
      </h3>
      <p className="muted">
        Read this through. When you agree, you pay the total with PayPal (sandbox).
      </p>

      <h4>The event</h4>
      <ul className="booking-facts">
        <li>
          <strong>Date</strong>
          <span>{new Date(event.date).toLocaleDateString('en-US', { dateStyle: 'long' })}</span>
        </li>
        <li>
          <strong>People</strong>
          <span>{event.headcount}</span>
        </li>
        <li>
          <strong>Max spend</strong>
          <span>
            {event.maxSpend ? formatMoney(event.maxSpend.amountMinor, event.maxSpend.currency) : 'Not set'}
          </span>
        </li>
      </ul>

      <h4>The venue</h4>
      <ul className="booking-facts">
        <li>
          <strong>Venue</strong>
          <span>
            {venue.name}, {venue.area}
          </span>
        </li>
        <li>
          <strong>Includes</strong>
          <span>{venue.includes.join(', ')}</span>
        </li>
        <li>
          <strong>Catering</strong>
          <span>
            {{ yes: 'Mentioned on the page', no: 'Not included', unknown: 'Not stated' }[venue.catering]}
          </span>
        </li>
        {source && (
          <li>
            <strong>Source</strong>
            <span>
              <a href={source.href} target="_blank" rel="noreferrer">
                {source.host}
              </a>
              . Confirm the figures with the venue.
            </span>
          </li>
        )}
      </ul>

      <h4>What it costs</h4>
      <ul className="booking-lines">
        {estimate.lines.map((line) => (
          <li key={line.label}>
            <span>{line.label}</span>
            <span>{formatMoney(line.amountMinor, estimate.currency)}</span>
          </li>
        ))}
        <li className="booking-lines-total">
          <span>One-day estimate</span>
          <span>{formatMoney(estimate.total, estimate.currency)}</span>
        </li>
        <li>
          <span>Demo exchange rate</span>
          <span>1 USD = {formatMoney(fx.localMinorPerUsd, fx.from)}</span>
        </li>
      </ul>
      <p className="booking-total">
        <span>Total to pay</span>
        <strong>{total}</strong>
      </p>

      {summary.overMaxSpend && (
        <p className="booking-warning" role="alert">
          This is over your max spend, so the spending rules will block it. Raise the max spend from
          the chat header first.
        </p>
      )}

      {canPay && (
        <div className="booking-agree">
          <label>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>I have read this plan and agree to pay {total} with PayPal.</span>
          </label>
          <div className="booking-actions">
            <button type="button" className="booking-pay" disabled={!agreed} onClick={pay}>
              Agree and pay with PayPal
            </button>
            <button type="button" className="link-button" onClick={onBack}>
              Back to venues
            </button>
          </div>
        </div>
      )}
      {state.kind === 'paying' && (
        <span className="booking-status" role="status">
          Checking the rules…
        </span>
      )}

      {state.kind === 'signin' && (
        <div className="booking-body" role="alert">
          <p>Only the treasurer can move money. Sign in to pay for this plan.</p>
          <div className="booking-actions">
            <a
              className="booking-pay"
              href="/api/auth/paypal/login"
              onClick={() => rememberReturnPath(window.location.pathname)}
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
        <p className="booking-body booking-error" role="alert">
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
        <p className="booking-body booking-paid" role="status">
          Paid with PayPal. PayPal reference{' '}
          <code>{outcome.captureId ?? outcome.orderId}</code>. It is in the audit log.
        </p>
      );
    case 'needs_approval':
      return (
        <div className="booking-body">
          <p>
            The rules sent this to the treasurer: {outcome.reasons.join('; ')}. Approve it in PayPal
            to pay.
          </p>
          {/* A venue booking is a purchase, so it always has a PayPal order; only a payout (not shown here) has none. */}
          {outcome.paypalOrderId && (
            <ApproveButtons
              approvalId={outcome.approvalId}
              orderId={outcome.paypalOrderId}
              onApproved={onApproved}
            />
          )}
        </div>
      );
    case 'blocked':
      return (
        <p className="booking-body booking-error" role="alert">
          Blocked by the spending rules: {outcome.reasons.join('; ')}.
        </p>
      );
    case 'refused':
      return outcome.reason === 'no_wallet' || outcome.reason === 'paypal_refused' ? (
        <div className="booking-body" role="alert">
          <p>
            {outcome.reason === 'no_wallet'
              ? 'The agent has no PayPal wallet connected, so nothing can be paid.'
              : 'PayPal refused the charge: the wallet was revoked with the kill switch.'}{' '}
            Connect a sandbox PayPal account to pay.
          </p>
          <div className="booking-actions">
            <button type="button" className="booking-pay" onClick={onConnectWallet}>
              Connect the agent&apos;s PayPal wallet
            </button>
          </div>
        </div>
      ) : (
        <p className="booking-body booking-error" role="alert">
          Not paid: {outcome.reason.replaceAll('_', ' ')}.
        </p>
      );
    case 'failed':
      return (
        <div className="booking-body booking-error" role="alert">
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
      <div ref={container} className="booking-paypal" />
      {error && (
        <p className="booking-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
