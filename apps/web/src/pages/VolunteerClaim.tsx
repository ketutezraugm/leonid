import type { ClaimView, VolunteerClaimsResponse } from '@quartermaster/shared';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { loadMyClaims, photoProblem, submitClaim } from '../claims/api';
import { ClaimList } from '../claims/ClaimList';
import { ApiFailure } from '../shell/api';
import { claimStatusView } from '../ui/claimStatus';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';
import { StatusBadge } from '../ui/StatusBadge';

// F16, the volunteer's side: open your link, snap a receipt, see when you are paid back. No account: the link
// is the volunteer's, and money only ever goes to the PayPal email the treasurer registered for them.

// What the volunteer reads right after sending a receipt.
export function resultText(c: ClaimView): string {
  const amount = c.amount === null ? '' : ` for ${formatMoney(c.amount, c.currency)}`;
  switch (c.status) {
    case 'approved':
    case 'paid':
      return `Approved${amount}. PayPal is sending it to your account.`;
    case 'pending_approval':
      return `Sent to the treasurer${amount}. You will be paid once they approve it.`;
    case 'rejected':
      return `This claim was declined: ${c.reasons.join('; ')}.`;
    default:
      return `Received. The treasurer will check the receipt${amount}.`;
  }
}

export function VolunteerClaim() {
  const token = useParams().token ?? '';
  const [data, setData] = useState<VolunteerClaimsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error'; claim?: ClaimView } | null>(null);

  const load = useCallback(() => {
    loadMyClaims(token).then(setData, (err: unknown) =>
      setLoadError(
        err instanceof ApiFailure && err.status === 401
          ? 'This claim link is not valid. Ask the treasurer for a new one.'
          : 'Your claims could not be loaded.',
      ),
    );
  }, [token]);
  useEffect(load, [load]);

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // the same photo can be chosen again after a failure
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      setMessage({ text: problem, tone: 'error' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const claim = await submitClaim(token, file);
      setData((d) => (d ? { ...d, claims: [claim, ...d.claims] } : d));
      setMessage({ text: resultText(claim), tone: claim.status === 'rejected' ? 'error' : 'ok', claim });
    } catch (err) {
      setMessage({ text: err instanceof ApiFailure ? err.message : 'The receipt could not be sent. Try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <PageState
        kind="error"
        title="This link doesn't work"
        onRetry={() => {
          setLoadError(null);
          load();
        }}
      >
        {loadError}
      </PageState>
    );
  }
  if (!data) return <PageState kind="loading" title="Loading your claims…" />;

  return (
    <section>
      <PageHeader
        title={`Hi ${data.volunteer.name}`}
        description={`Paid for something for ${data.volunteer.eventName}? Snap the receipt and you are paid back to your PayPal account.`}
      />
      <section className="card claim-snap" aria-label="New claim">
        <input
          id="receipt-photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={onPhoto}
          disabled={busy}
        />
        <label htmlFor="receipt-photo" className="btn btn-primary claim-snap-button" aria-disabled={busy || undefined}>
          {busy ? 'Reading the receipt…' : 'Snap a receipt'}
        </label>
        <p className="muted">
          The amount is read from the receipt.{' '}
          {data.dailyLimit
            ? `Claims up to ${formatMoney(data.dailyLimit.amount, data.dailyLimit.currency)} a day are paid automatically.`
            : 'Claims within the daily limit are paid automatically.'}
        </p>
        {message?.tone === 'error' && (
          <p role="alert" className="field-error">
            {message.text}
          </p>
        )}
        {message?.tone === 'ok' && message.claim && (
          <div role="status" className="claim-result">
            <StatusBadge
              status={claimStatusView[message.claim.status].status}
              label={claimStatusView[message.claim.status].label}
            />
            <span>{message.text}</span>
          </div>
        )}
      </section>
      <section className="card" aria-label="Your claims">
        <h2 className="card-title">Your claims</h2>
        {data.claims.length === 0 ? <p className="muted">No claims yet.</p> : <ClaimList claims={data.claims} />}
      </section>
    </section>
  );
}
