import { PayoutsResponse, type PayoutItem } from '@leonid/shared';
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
// PayPal reports it. Each one goes through the rules engine (checked and audited) and, when allowed, is sent at
// once: there is no approval step. "Paid" comes only from PayPal's payout webhooks.

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

// Where winners and speakers are most likely to be. The names come from the browser, so they read "India", not "IN".
const COUNTRY_CODES = [
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'CN', 'CO', 'CZ', 'DK', 'EG', 'FI', 'FR', 'DE', 'GH', 'GR', 'HK', 'HU', 'IN',
  'ID', 'IE', 'IL', 'IT', 'JP', 'KE', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NG', 'NO', 'PK', 'PE', 'PH', 'PL', 'PT', 'RO', 'SA',
  'SG', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TH', 'TR', 'AE', 'GB', 'US', 'VN',
];
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string) => regionNames.of(code) ?? code;
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
  a.name.localeCompare(b.name),
);

function NewPayout({ eventId, onSent }: { eventId: string | null; onSent: () => void }) {
  const [kind, setKind] = useState<'prize' | 'speaker'>('prize');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutItem | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const minor = parseMoneyInput(amount);
    if (minor === null || minor <= 0) {
      setError('Enter an amount in US dollars, for example 250.00.');
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
        ...(country ? { countryCode: country } : {}),
        amount: minor,
        category: kind === 'prize' ? 'prizes' : 'speakers',
      });
      setResult(payouts[0]!);
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
        <div className="field">
          <label htmlFor="payout-country">Country (optional)</label>
          <select id="payout-country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Not set</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Field
          id="payout-amount"
          label="Amount (US dollars)"
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
          {result.recipientName}: {STATUS[result.status].label}
          {result.note ? ` (${result.note})` : ''}.
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
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Who</th>
                    <th>Country</th>
                    <th>Status</th>
                    <th className="num">Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.payouts.map((p) => (
                    <tr key={p.id}>
                      <td>{KIND[p.kind]}</td>
                      <td>
                        {p.recipientName}
                        <span className="muted"> · {p.destination.receiver}</span>
                      </td>
                      <td>{p.destination.countryCode ? countryName(p.destination.countryCode) : '—'}</td>
                      <td>
                        <StatusBadge status={STATUS[p.status].status} label={STATUS[p.status].label} />
                      </td>
                      <td className="num">{formatMoney(p.amount, p.currency)}</td>
                      <td className="muted">{p.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>
    </>
  );
}
