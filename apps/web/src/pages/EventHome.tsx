import { Link } from 'react-router-dom';
import { ApprovalsResponse } from '@quartermaster/shared';
import { waitingItems } from '../approvals/capture';
import { SAMPLE_ALERTS, SAMPLE_BUDGET, SAMPLE_RECENT_SPENDS } from '../home/budget';
import { RunwayStrip } from '../home/RunwayStrip';
import { useFetch } from '../shell/api';
import { BudgetBar, unlockedToSpend } from '../ui/BudgetBar';
import { Card } from '../ui/Card';
import { CopyId } from '../ui/CopyId';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { StatTile } from '../ui/StatTile';
import { StatusBadge } from '../ui/StatusBadge';

// Event home answers one question: what needs me, and how much can we spend? Waiting approvals are live;
// the budget, recent spends and alerts are sample data until P1's budget endpoint and the ledger feeds exist.
export function EventHome() {
  const approvals = useFetch('/api/approvals', ApprovalsResponse);
  const waiting = approvals.kind === 'ready' ? waitingItems(approvals.data.approvals) : [];
  const oldest = waiting[0];
  const budget = SAMPLE_BUDGET;

  const finding = oldest
    ? `${oldest.vendor ?? oldest.category ?? 'A cart'} (${formatMoney(oldest.amountMinor, oldest.currency)}) is waiting on you: ${oldest.reasons[0] ?? 'it needs your approval'}.`
    : approvals.kind === 'ready'
      ? 'Nothing is waiting on you.'
      : approvals.kind === 'error'
        ? approvals.error.status === 401
          ? 'Sign in to see what is waiting on you.'
          : "We couldn't check what is waiting on you. Approvals will show here when they load."
        : 'Checking what is waiting on you…';

  return (
    <section className="home">
      <PageHeader
        title="Event home"
        description={finding}
        actions={
          oldest && (
            <Link to="/approvals" className="btn btn-primary">
              Review approval
            </Link>
          )
        }
      />

      <RunwayStrip />

      <div className="home-grid">
        <section className="card home-hero" aria-label="Unlocked to spend">
          <StatTile
            label="Unlocked to spend"
            value={formatMoney(unlockedToSpend(budget), budget.currency)}
            meta="Cleared income minus committed spend. Invoiced and pledged money is not spendable."
          />
          <BudgetBar figures={budget} />
          <p className="muted sample-note">Sample figures until the budget endpoint is connected.</p>
        </section>

        <Card title="Waiting on you">
          {oldest ? (
            <div className="waiting">
              <p>
                <strong>{oldest.vendor ?? oldest.category ?? oldest.referenceId}</strong>{' '}
                <span className="num">{formatMoney(oldest.amountMinor, oldest.currency)}</span>
              </p>
              <StatusBadge status="risk" label="Needs approval" />
              <Link to="/approvals">Open in Approvals</Link>
            </div>
          ) : (
            <p className="muted">Nothing is waiting on you.</p>
          )}
        </Card>
      </div>

      <div className="home-grid">
        <Card title="Recent spends">
          <div className="table-wrap table-wrap--flush">
            <table className="table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Rules said</th>
                  <th className="num">Amount</th>
                  <th>PayPal ID</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_RECENT_SPENDS.map((spend) => (
                  <tr key={spend.id}>
                    <td>{spend.what}</td>
                    <td>
                      <StatusBadge status={spend.result === 'Allowed' ? 'done' : 'risk'} label={spend.result} />
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
        </Card>

        <Card title="Alerts">
          <ul className="alert-list">
            {SAMPLE_ALERTS.map((alert) => (
              <li key={alert.id}>
                <StatusBadge status={alert.tone} label={alert.tone === 'risk' ? 'At risk' : 'Not paid'} />
                <Link to={alert.to}>{alert.text}</Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
