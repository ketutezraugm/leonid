import { PayoutsResponse, type PayoutItem } from '@quartermaster/shared';
import { useState, type FormEvent } from 'react';
import { ApiFailure, errorMessage, sendJson, useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { formatMoney, parseMoneyInput } from '../ui/money';
import { PageState } from '../ui/PageState';
import { StatusBadge, type Status } from '../ui/StatusBadge';
import '../claims/claims.css';

// F17 on the Money screen: pay a prize winner or a speaker, and follow every payout (claims included) as
// PayPal reports it. Each one goes through the rules engine; above the payout threshold it waits on the
// Approvals screen. "Paid" comes only from PayPal's payout webhooks.

const STATUS: Record<PayoutItem['status'], { label: string; status: Status }> = {
  pending_approval: { label: 'Waiting on approval', status: 'risk' },
  queued: { label: 'Queued', status: 'pending' },
  processing: { label: 'Sent to PayPal', status: 'progress' },
  paid: { label: 'Paid', status: 'done' },
  failed: { label: 'Failed', status: 'blocked' },
  unclaimed: { label: 'Unclaimed', status: 'risk' },
  returned: { label: 'Returned', status: 'blocked' },
  blocked: { label: 'Blocked', status: 'blocked' },
};
const KIND = { prize: 'Prize', speaker: 'Speaker', claim: 'Claim' } as const;

function NewPayout({ eventId, onSent }: { eventId: string | null; onSent: () => void }) {
  const [kind, setKind] = useState<'prize' | 'speaker'>('prize');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoneyInput(amount);
    if (minor === null || minor <= 0) {
      setError('Enter an amount, for example 250.00.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { payouts } = await sendJson('/api/payouts', PayoutsResponse, {
        ...(eventId ? { eventId } : {}),
        kind,
        recipientName: name.trim(),
        recipientEmail: email.trim(),
        ...(country ? { countryCode: country.toUpperCase() } : {}),
        amount: minor,
        category: kind === 'prize' ? 'prizes' : 'speakers',
      });
      const item = payouts[0]!;
      setResult(`${item.recipientName}: ${STATUS[item.status].label}${item.note ? ` (${item.note})` : ''}.`);
      setName('');
      setEmail('');
      setAmount('');
      onSent();
    } catch (err) {
      setError(
        err instanceof ApiFailure && err.status === 422
          ? 'Check the name, the PayPal email and the amount.'
          : 'The payout could not be started.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Pay a prize or a speaker">
      <h2 className="card-title">Pay a prize or a speaker</h2>
      <form className="claim-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="payout-kind">Type</label>
          <select id="payout-kind" value={kind} onChange={(e) => setKind(e.target.value as 'prize' | 'speaker')}>
            <option value="prize">Prize</option>
            <option value="speaker">Speaker fee</option>
          </select>
        </div>
        <Field id="payout-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <Field
          id="payout-email"
          label="PayPal email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          id="payout-country"
          label="Country (optional)"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          maxLength={2}
          pattern="[A-Za-z]{2}"
          hint="Two letters, for example IN"
        />
        <Field
          id="payout-amount"
          label="Amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          error={error ?? undefined}
        />
        <Button type="submit" variant="primary" busy={busy} busyLabel="Checking the rules…">
          Pay through the rules
        </Button>
      </form>
      {result && (
        <p role="status" className="muted">
          {result}
        </p>
      )}
    </section>
  );
}

export function Payouts() {
  const event = useEvent();
  const list = useFetch(withEvent('/api/payouts', event), PayoutsResponse);

  return (
    <>
      <NewPayout eventId={event.id} onSent={list.refresh} />
      <section className="card" aria-label="Payouts">
        <h2 className="card-title">Payouts</h2>
        {list.kind === 'loading' && <PageState kind="loading" title="Loading payouts…" />}
        {list.kind === 'error' && (
          <PageState kind="error" title={errorMessage(list.error).title} onRetry={list.reload}>
            {errorMessage(list.error).detail}
          </PageState>
        )}
        {list.kind === 'ready' &&
          (list.data.payouts.length === 0 ? (
            <p className="muted">No payouts yet.</p>
          ) : (
            <ul className="claim-list">
              {list.data.payouts.map((p) => (
                <li key={p.id} className="claim-row">
                  <div className="claim-main">
                    <span className="claim-what">
                      <strong>{KIND[p.kind]}</strong> · {p.recipientName}
                      {p.destination.countryCode ? ` (${p.destination.countryCode})` : ''}
                    </span>
                    <span className="claim-amount">{formatMoney(p.amount, p.currency)}</span>
                  </div>
                  <div className="claim-meta">
                    <StatusBadge status={STATUS[p.status].status} label={STATUS[p.status].label} />
                    <span className="muted">{p.destination.receiver}</span>
                  </div>
                  {p.note && <p className="claim-reasons muted">{p.note}</p>}
                </li>
              ))}
            </ul>
          ))}
      </section>
    </>
  );
}
