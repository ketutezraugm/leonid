import { Link } from 'react-router-dom';
import { ApprovalsResponse } from '@quartermaster/shared';
import { waitingItems } from '../approvals/capture';
import { SAMPLE_ALERTS, SAMPLE_BUDGET, SAMPLE_RECENT_SPENDS } from '../home/budget';
import { NeedsYou } from '../home/NeedsYou';
import { RunwayStrip } from '../home/RunwayStrip';
import { useFetch } from '../shell/api';
import { daysUntil, EVENT, formatEventDate } from '../shell/event';
import { BudgetBar, unlockedToSpend } from '../ui/BudgetBar';
import { CopyId } from '../ui/CopyId';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';

function ledgerDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

// Event home answers one question: what needs me, and how much can we spend? Those two lead; the ledger and the
// plan follow. Waiting approvals are live; the budget, spends and alerts are sample data until P1's budget
// endpoint and the ledger feeds exist, and each says so.
export function EventHome() {
  const approvals = useFetch('/api/approvals', ApprovalsResponse);
  const waiting = approvals.kind === 'ready' ? waitingItems(approvals.data.approvals) : [];
  const budget = SAMPLE_BUDGET;
  const days = daysUntil(EVENT.date);

  return (
    <section className="home">
      <PageHeader
        title="Event home"
        description={
          <>
            <span className="countdown num">{days} days</span> to {EVENT.name} on {formatEventDate(EVENT.date)},
            2027.
          </>
        }
      />

      <div className="home-top">
        <section className="unlocked" aria-labelledby="unlocked-title">
          <h2 id="unlocked-title">Unlocked to spend</h2>
          <p className="unlocked-figure num">{formatMoney(unlockedToSpend(budget), budget.currency)}</p>
          <p className="muted unlocked-rule">
            Cleared sponsor money minus what is already spent or committed. Invoiced and pledged money can’t be spent
            until it clears.
          </p>
          <BudgetBar figures={budget} />
          <p className="sample-tag">Sample figures</p>
        </section>

        <NeedsYou state={approvals.kind} waiting={waiting} onRetry={approvals.reload} />
      </div>

      <div className="home-grid">
        <section className="card ledger" aria-labelledby="ledger-title">
          <div className="section-head">
            <h2 id="ledger-title">Recent spends</h2>
            <span className="sample-tag">Sample</span>
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
              {SAMPLE_RECENT_SPENDS.map((spend) => (
                <tr key={spend.id}>
                  <td className="ledger-date num">{ledgerDate(spend.date)}</td>
                  <td>{spend.what}</td>
                  <td>
                    <span className="ledger-verdict">
                      <StatusBadge status={spend.result === 'Allowed' ? 'done' : 'risk'} label={spend.result} />
                      <span className="ledger-reason">{spend.reason}</span>
                    </span>
                  </td>
                  <td className="num">{formatMoney(spend.amount, budget.currency)}</td>
                  <td>
                    <CopyId value={spend.paypalId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>

        <section className="card" aria-labelledby="alerts-title">
          <div className="section-head">
            <h2 id="alerts-title">Alerts</h2>
            <span className="sample-tag">Sample</span>
          </div>
          <ul className="alert-list">
            {SAMPLE_ALERTS.map((alert) => (
              <li key={alert.id}>
                <StatusBadge status={alert.tone} label={alert.tone === 'risk' ? 'At risk' : 'Not paid'} />
                <p>{alert.text}</p>
                <Link to={alert.to}>{alert.to === '/plan' ? 'Open the plan' : 'Open Money'}</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <RunwayStrip />
    </section>
  );
}
