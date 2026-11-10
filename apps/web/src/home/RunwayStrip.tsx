import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PlanResponse, SponsorsResponse } from '@leonid/shared';
import { useFetch } from '../shell/api';
import { useEvent, useEventPath, withEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { PlanCalendarPanel } from './PlanCalendarPanel';
import { planSummary, toPlanEvents } from './planEvents';

// The event's own plan (GET /api/events/:id/plan) in Bryntum Calendar: Day and Week on an hour grid, Month as days,
// opening on the event day's month. Read-only; the Bryntum Gantt stays on the Plan screen.
export function RunwayStrip() {
  const event = useEvent();
  const path = useEventPath();
  const plan = useFetch(`/api/events/${encodeURIComponent(event.id ?? 'demo')}/plan`, PlanResponse);

  const feed = useFetch(withEvent('/api/sponsors', event), SponsorsResponse);
  const events = useMemo(
    () =>
      plan.kind === 'ready'
        ? toPlanEvents(plan.data, new Date(), feed.kind === 'ready' ? feed.data.sponsors : [])
        : null,
    [plan, feed],
  );
  const summary = events ? planSummary(events) : null;

  return (
    <section className="runway" aria-labelledby="runway-title">
      <div className="runway-head">
        <h2 id="runway-title">Plan</h2>
        {plan.kind === 'loading' && (
          <p className="muted" role="status">
            Loading the plan…
          </p>
        )}
        {plan.kind === 'error' && (
          <p className="muted">
            Couldn’t load the plan.{' '}
            <Button variant="secondary" onClick={plan.reload}>
              Try again
            </Button>
          </p>
        )}
        {events && events.length === 0 && (
          <p className="muted">
            No plan yet. Ask the agent to plan this event and its tasks show up here.
          </p>
        )}
        {summary && events && events.length > 0 && (
          <p className="muted">
            {summary.flagged > 0
              ? `${summary.flagged} ${summary.flagged === 1 ? 'task' : 'tasks'} late or at risk`
              : 'Everything is on track'}
            {summary.next.length > 0 && <> · Next: {summary.next.join(', ')}</>}
          </p>
        )}
        <Link to={path('plan')}>Open the plan</Link>
      </div>

      {plan.kind === 'ready' && events && events.length > 0 && (
        <>
          <PlanCalendarPanel events={events} eventDate={plan.data.eventDate} />
          <div className="badge-row">
            <StatusBadge status="done" />
            <StatusBadge status="progress" />
            <StatusBadge status="pending" />
            <StatusBadge status="risk" label="At risk" />
            <StatusBadge status="blocked" label="Late" />
          </div>
        </>
      )}
    </section>
  );
}
