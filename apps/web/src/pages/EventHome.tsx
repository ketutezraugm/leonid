import { Link } from 'react-router-dom';
import { ApprovalsResponse } from '@quartermaster/shared';
import { waitingItems } from '../approvals/capture';
import { SAMPLE_ALERTS, SAMPLE_BUDGET } from '../home/budget';
import { NeedsYou } from '../home/NeedsYou';
import { RecentSpends } from '../home/RecentSpends';
import { RunwayStrip } from '../home/RunwayStrip';
import { useFetch } from '../shell/api';
import { daysUntil, EVENT, formatEventDate } from '../shell/event';
import { BudgetBar, unlockedToSpend } from '../ui/BudgetBar';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';

// Event home answers one question: what needs me, and how much can we spend? Those two lead; the ledger and the
// plan follow. Waiting approvals and recent spends are live; the budget and alerts are sample data until P1's
// budget endpoint and the delivery feed exist, and each says so.
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
        <RecentSpends />

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
