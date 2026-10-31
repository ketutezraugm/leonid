import { RulesHealthResponse, type RuleDecision } from '@quartermaster/shared';
import { useFetch } from '../shell/api';
import { CopyId } from '../ui/CopyId';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';
import { SAMPLE_RECENT_SPENDS } from './budget';

const decisions: Record<RuleDecision, { status: 'done' | 'risk' | 'blocked'; label: string }> = {
  allow: { status: 'done', label: 'Allowed' },
  needs_approval: { status: 'risk', label: 'Needs approval' },
  block: { status: 'blocked', label: 'Blocked' },
};

const toneOf = { Allowed: 'done', 'Needs approval': 'risk', Blocked: 'blocked' } as const;

function ledgerDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
  );
}

function Verdict({ status, label, reason }: { status: 'done' | 'risk' | 'blocked'; label: string; reason?: string }) {
  return (
    <span className="ledger-verdict">
      <StatusBadge status={status} label={label} />
      {reason && <span className="ledger-reason">{reason}</span>}
    </span>
  );
}

// The rules-health feed once spends have gone through the rules; sample rows, labelled, until then
// (the feed needs the database, and has no rows on a fresh event). The feed carries no PayPal ID yet.
export function RecentSpends() {
  const feed = useFetch('/api/widgets/rules-health', RulesHealthResponse);
  const live = feed.kind === 'ready' ? feed.data.data.recent.filter((entry) => entry.amount !== null) : [];

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
              {live.length === 0 && <th>PayPal ID</th>}
            </tr>
          </thead>
          <tbody>
            {live.map((entry) => (
              <tr key={entry.auditId}>
                <td className="ledger-date num">{ledgerDate(entry.at)}</td>
                <td>{entry.category ?? 'Spend'}</td>
                <td>
                  <Verdict {...decisions[entry.result.decision]} reason={entry.result.reasons[0]} />
                </td>
                <td className="num">{formatMoney(entry.amount ?? 0, entry.currency ?? 'USD')}</td>
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
