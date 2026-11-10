import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alerts } from '../home/Alerts';
import { BalanceCard } from '../home/BalanceCard';
import { RecentSpends } from '../home/RecentSpends';
import { RunwayStrip } from '../home/RunwayStrip';
import { DeleteEventDialog } from '../shell/DeleteEventDialog';
import { daysUntil, formatEventDate, useEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';

// Home answers two questions: how much can we spend, and what could go wrong? Those lead; the ledger and the
// plan follow. Every figure is live: PayPal balance and the sponsor ledger, delivery risk and invoices, the
// spends the rules decided, and the event's own plan. Nothing here is sample data.
export function EventHome() {
  const event = useEvent();
  const days = daysUntil(event.date);
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  return (
    <section className="home">
      <PageHeader
        title="Home"
        description={
          <>
            <span className="countdown num">{days} days</span> to {event.name} on{' '}
            {formatEventDate(event.date)}.
          </>
        }
      />

      <div className="home-top">
        <BalanceCard />
        <Alerts />
      </div>

      <RecentSpends />

      <RunwayStrip />

      {/* The demo fallback has no API id, so there is nothing to delete. */}
      {event.id && (
        <section className="card event-delete" aria-labelledby="event-delete-title">
          <div>
            <h2 id="event-delete-title">Delete this event</h2>
            <p className="muted">
              Removes its plan, sponsors and agent chats. Only an event that has never taken or
              spent money can be deleted.
            </p>
          </div>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete event
          </Button>
        </section>
      )}

      {deleting && (
        <DeleteEventDialog
          event={event}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate('/events', { replace: true })}
        />
      )}
    </section>
  );
}
