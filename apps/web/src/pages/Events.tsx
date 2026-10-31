import { Link } from 'react-router-dom';
import { countdown, daysUntil, eventPath, formatLongDate, useEvents, type EventInfo } from '../shell/event';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// All events: the first screen after sign-in. A list to scan, nearest date first; each card opens that event.
// Per-event money and Needs-you counts join the cards once the API scopes them per event.
export function Events() {
  const { kind, events } = useEvents();
  const byDate = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = byDate.filter((e) => daysUntil(e.date) >= 0);
  const past = byDate.filter((e) => daysUntil(e.date) < 0).reverse();

  return (
    <section className="events">
      <PageHeader
        title="Your events"
        description="Each event keeps its own budget, plan, approvals, rules and claims."
        actions={
          <Link to="/setup" className="btn btn-primary">
            New event
          </Link>
        }
      />

      {kind === 'loading' && <PageState kind="loading" title="Loading your events…" />}

      {kind === 'ready' && events.length === 0 && (
        <PageState kind="empty" title="Create your first event">
          Add its date, headcount and budget, and Quartermaster sets up its plan and money.
        </PageState>
      )}

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

      {kind === 'fallback' && (
        <p className="sample-tag events-note">
          Showing the demo event. Your other events appear here once the events endpoint is connected.
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
        {formatLongDate(event.date)} · {event.people} people
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
