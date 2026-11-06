import { useEffect } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../ui/Button';
import { PageState } from '../ui/PageState';
import { rememberEvent, useCurrentEvent, useEventRouteId, useEvents } from './event';

// Wraps every /events/:eventId/ screen: waits for the event list, says plainly when the event is not one of
// the user's (or the list could not be loaded), and remembers the event so old links (/plan, /agent …) reopen it.
export function EventScope() {
  const routeId = useEventRouteId();
  const { kind, refresh } = useEvents();
  const event = useCurrentEvent();

  useEffect(() => {
    if (event) rememberEvent(event.routeId);
  }, [event]);

  if (kind === 'loading') return <PageState kind="loading" title="Loading the event…" />;
  if (!event) {
    return (
      <PageState kind="empty" title="This event isn’t here">
        {routeId ? 'It may have been removed, or it belongs to someone else. ' : ''}
        {kind === 'fallback' && (
          <>
            Your events could not be loaded. <Button onClick={refresh}>Try again</Button>{' '}
          </>
        )}
        <Link to="/events">See all your events</Link>
      </PageState>
    );
  }
  return <Outlet />;
}
