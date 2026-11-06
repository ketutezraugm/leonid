import { Link } from 'react-router-dom';
import { ApprovalsResponse, EventOverview as EventOverviewData } from '@quartermaster/shared';
import { waitingItems } from '../approvals/capture';
import { errorMessage, useFetch } from '../shell/api';
import { countdown, formatLongDate, useEventPath, withEvent, type EventInfo } from '../shell/event';
import { Button } from '../ui/Button';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { NeedsYou } from './NeedsYou';

// Event home for an event the person made. Everything on it is this event's own: the countdown and budget target come
// from the event, the unlocked figure from the same funds-gated budget that check() spends against (cleared income minus
// committed spend), and the approvals from its own queue. Nothing here is sample data. Recent spends, alerts and the
// plan strip stay on the demo until they are scoped per event.
export function EventOverview({ event, eventId }: { event: EventInfo; eventId: string }) {
  const path = useEventPath();
  const overview = useFetch(`/api/events/${encodeURIComponent(eventId)}/overview`, EventOverviewData);
  const approvals = useFetch(withEvent('/api/approvals', event), ApprovalsResponse);
  const waiting = approvals.kind === 'ready' ? waitingItems(approvals.data.approvals) : [];

  return (
    <section className="home">
      <PageHeader
        title="Event home"
        description={
          <>
            <span className="countdown num">{countdown(event.date)}</span> · {event.name} on {formatLongDate(event.date)}
            , {event.people} people.
          </>
        }
      />

      <div className="home-top">
        <section className="unlocked" aria-labelledby="unlocked-title">
          <h2 id="unlocked-title">Unlocked to spend</h2>
          {overview.kind === 'ready' && (
            <>
              <p className="unlocked-figure num">{formatMoney(overview.data.unlockedMinor, event.currency)}</p>
              <p className="muted unlocked-rule">
                {overview.data.unlockedMinor === 0
                  ? 'Nothing is unlocked yet. Spending opens up as sponsor money clears; pledged and invoiced money can’t be spent until it does, so the agent can’t buy anything for this event yet.'
                  : 'Cleared income minus what is already spent or committed. Invoiced and pledged money can’t be spent until it clears.'}
              </p>
            </>
          )}
          {overview.kind === 'loading' && (
            <p className="muted" role="status">
              Checking the budget…
            </p>
          )}
          {overview.kind === 'error' && (
            <p role="alert">
              {errorMessage(overview.error).title}. The unlocked figure isn’t shown until it loads.{' '}
              <Button onClick={overview.reload}>Try again</Button>
            </p>
          )}
        </section>

        <NeedsYou state={approvals.kind} waiting={waiting} onRetry={approvals.reload} />
      </div>

      <div className="home-grid">
        <section className="card" aria-labelledby="target-title">
          <h2 id="target-title">Budget target</h2>
          <p className="unlocked-figure num">{formatMoney(event.budget, event.currency)}</p>
          <p className="muted">What you plan to spend in total. It is a target, not money you have.</p>
          {event.categories.length > 0 && (
            <p>
              Categories: <span className="num">{event.categories.join(', ')}</span>
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="plan-title">
          <h2 id="plan-title">Plan</h2>
          {overview.kind === 'ready' ? (
            <p>
              {overview.data.tasks.length === 0
                ? 'No tasks yet.'
                : `${overview.data.tasks.length} task${overview.data.tasks.length === 1 ? '' : 's'} planned.`}{' '}
              <Link to={path(overview.data.tasks.length === 0 ? '/agent' : '/plan')}>
                {overview.data.tasks.length === 0 ? 'Ask the agent to plan it' : 'Open the plan'}
              </Link>
            </p>
          ) : (
            <p className="muted">The plan loads with the budget.</p>
          )}
        </section>
      </div>
    </section>
  );
}
