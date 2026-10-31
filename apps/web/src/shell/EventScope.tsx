import { useEffect } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { PageState } from '../ui/PageState';
import { rememberEvent, useCurrentEvent, useEventRouteId, useEvents } from './event';

// Wraps every /events/:eventId/ screen: waits for the event list, says plainly when the event is not one of
// the user's, and remembers the event so old links (/plan, /agent …) reopen it.
export function EventScope() {
  const routeId = useEventRouteId();
  const { kind } = useEvents();
  const event = useCurrentEvent();

  useEffect(() => {
    if (event) rememberEvent(event.routeId);
  }, [event]);

  if (kind === 'loading') return <PageState kind="loading" title="Loading the event…" />;
  if (!event) {
    return (
      <PageState kind="empty" title="This event isn’t here">
        {routeId ? 'It may have been removed, or it belongs to another organiser. ' : ''}
        <Link to="/events">See all your events</Link>
      </PageState>
    );
  }
  return <Outlet />;
}
