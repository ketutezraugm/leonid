import { SpendsResponse, type RuleDecision, type SpendEntry } from '@quartermaster/shared';
import { useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { CopyId } from '../ui/CopyId';
import { formatMoney } from '../ui/money';
import { StatusBadge, type Status } from '../ui/StatusBadge';
import { SAMPLE_RECENT_SPENDS } from './budget';

const decisions: Record<RuleDecision, { status: 'done' | 'risk' | 'blocked'; label: string }> = {
  allow: { status: 'done', label: 'Allowed' },
  needs_approval: { status: 'risk', label: 'Needs approval' },
  block: { status: 'blocked', label: 'Blocked' },
};

// How the spend ended, when that says more than the rules' decision (an allowed spend PayPal refused after the kill switch).
const outcomes: Partial<Record<SpendEntry['status'], { status: 'progress' | 'blocked'; label: string }>> = {
  capturing: { status: 'progress', label: 'Paying' },
  submitted: { status: 'progress', label: 'Sending' }, // a payout PayPal accepted and has not finished
  rejected: { status: 'blocked', label: 'Rejected' },
  refused: { status: 'blocked', label: 'Refused' },
  failed: { status: 'blocked', label: 'Failed' },
  error: { status: 'blocked', label: 'Failed' },
  mismatch: { status: 'blocked', label: 'Failed' },
};

const toneOf = { Allowed: 'done', 'Needs approval': 'risk', Blocked: 'blocked' } as const;

function ledgerDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
  );
}

function Verdict({ status, label, reason }: { status: Status; label: string; reason?: string }) {
  return (
    <span className="ledger-verdict">
      <StatusBadge status={status} label={label} />
      {reason && <span className="ledger-reason">{reason}</span>}
    </span>
  );
}

// The spends the payment executor decided (GET /api/spends/recent, treasurer only); sample rows, labelled, until there
// are some (the feed needs the database and a treasurer session, and has no rows on a fresh event).
export function RecentSpends() {
  const event = useEvent();
  const feed = useFetch(withEvent('/api/spends/recent?limit=8', event), SpendsResponse);
  const live = feed.kind === 'ready' ? feed.data.spends.filter((entry) => entry.amountMinor !== null) : [];

  return (
    <section className="card ledger" aria-labelledby="ledger-title">
      <div className="section-head">
        <h2 id="ledger-title">Recent spends</h2>
        {live.length === 0 && <span className="sample-tag">Sample</span>}
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>What</th>
              <th>Rules said</th>
              <th className="num">Amount</th>
              <th>PayPal ID</th>
            </tr>
          </thead>
          <tbody>
            {live.map((entry) => (
              <tr key={entry.id}>
                <td className="ledger-date num">{ledgerDate(entry.at)}</td>
                <td>{entry.vendor ?? entry.category ?? 'Spend'}</td>
                <td>
                  <Verdict {...(outcomes[entry.status] ?? decisions[entry.decision])} reason={entry.reasons[0]} />
                </td>
                <td className="num">{formatMoney(entry.amountMinor ?? 0, entry.currency ?? 'USD')}</td>
                <td>{entry.paypalId ? <CopyId value={entry.paypalId} /> : <span className="muted">None</span>}</td>
              </tr>
            ))}
            {live.length === 0 &&
              SAMPLE_RECENT_SPENDS.map((spend) => (
                <tr key={spend.id}>
                  <td className="ledger-date num">{ledgerDate(spend.date)}</td>
                  <td>{spend.what}</td>
                  <td>
                    <Verdict status={toneOf[spend.result]} label={spend.result} reason={spend.reason} />
                  </td>
                  <td className="num">{formatMoney(spend.amount)}</td>
                  <td>
                    <CopyId value={spend.paypalId} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
