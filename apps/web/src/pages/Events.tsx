import { Link } from 'react-router-dom';
import { countdown, daysUntil, eventPath, formatDateRange, useEvents, type EventInfo } from '../shell/event';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// All events: the first screen after sign-in. A list to scan, nearest date first; each card opens that event.
// The demo event is always the first; the rest are the ones this person made.
// Per-event money and Needs-you counts join the cards once the API scopes them per event.
export function Events() {
  const { kind, events, refresh } = useEvents();
  const byDate = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = byDate.filter((e) => daysUntil(e.date) >= 0);
  const past = byDate.filter((e) => daysUntil(e.date) < 0).reverse();

  return (
    <section className="events">
      <PageHeader
        title="Your events"
        description="Open an event to see its budget, plan and approvals."
        actions={
          <Link to="/setup" className="btn btn-primary">
            New event
          </Link>
        }
      />

      {kind === 'loading' && <PageState kind="loading" title="Loading your events…" />}


      {upcoming.length > 0 && (
        <ul className="event-cards">
          {upcoming.map((event) => (
            <li key={event.routeId}>
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <details className="past-events">
          <summary>Past events ({past.length})</summary>
          <ul className="event-cards">
            {past.map((event) => (
              <li key={event.routeId}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {kind === 'ready' && events.length === 1 && (
        <p className="muted events-note">
          Your own events appear here. <Link to="/setup">Create your first event</Link> with its date, headcount and
          budget.
        </p>
      )}

      {kind === 'fallback' && (
        <p className="sample-tag events-note">
          Showing the demo event. Your own events could not be loaded.{' '}
          <Button onClick={refresh}>Try again</Button>
        </p>
      )}
    </section>
  );
}

function EventCard({ event }: { event: EventInfo }) {
  const over = daysUntil(event.date) < 0;
  return (
    <Link to={eventPath(event.routeId)} className="event-card">
      <span className="event-card-name">{event.name}</span>
      <span className="event-card-meta">
        {formatDateRange(event.date, event.endDate)} · {event.people} people
      </span>
      <span className={`event-card-days num${over ? ' event-card-days--over' : ''}`}>{countdown(event.date)}</span>
      <span className="event-card-open" aria-hidden="true">
        Open
        <svg viewBox="0 0 24 24">
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </Link>
  );
}
