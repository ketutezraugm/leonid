import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DeleteEventDialog } from '../shell/DeleteEventDialog';
import { countdown, daysUntil, eventPath, formatLongDate, useEvents, type EventInfo } from '../shell/event';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// All events: the first screen after sign-in. A list to scan, nearest date first; each card opens that event.
// Per-event money and Needs-you counts join the cards once the API scopes them per event.
// Delete is offered on every card, but the server refuses the demo event and any event with money history.
export function Events() {
  const { kind, events } = useEvents();
  const [deleting, setDeleting] = useState<EventInfo | null>(null);
  const byDate = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = byDate.filter((e) => daysUntil(e.date) >= 0);
  const past = byDate.filter((e) => daysUntil(e.date) < 0).reverse();
  // The demo fallback has no API id, so there is nothing to delete.
  const onDelete = kind === 'ready' ? setDeleting : undefined;

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

      {kind === 'ready' && events.length === 0 && (
        <PageState kind="empty" title="Create your first event">
          Add its date, headcount and budget, and Leo sets up its plan and money.
        </PageState>
      )}

      {upcoming.length > 0 && (
        <ul className="event-cards">
          {upcoming.map((event) => (
            <li key={event.routeId}>
              <EventCard event={event} onDelete={onDelete} />
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
                <EventCard event={event} onDelete={onDelete} />
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

      {deleting && <DeleteEventDialog event={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function EventCard({ event, onDelete }: { event: EventInfo; onDelete?: (event: EventInfo) => void }) {
  const over = daysUntil(event.date) < 0;
  return (
    <div className="event-card-wrap">
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
      {onDelete && (
        <button
          type="button"
          className="event-card-delete"
          aria-label={`Delete ${event.name}`}
          title="Delete event"
          onClick={() => onDelete(event)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
