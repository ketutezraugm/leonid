import { useEffect } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageState } from '../ui/PageState';
import {
  DEMO_ROUTE_ID,
  eventPath,
  rememberEvent,
  useCurrentEvent,
  useEventRouteId,
  useEvents,
} from './event';

// Wraps every /events/:eventId/ screen: waits for the event list, says plainly when the event is not one of
// the user's, and remembers the event so old links (/plan, /agent …) reopen it. A /events/demo/… link (a bookmark,
// the landing page's try-it cards) opens the same screen in the first real event once there are real events.
export function EventScope() {
  const routeId = useEventRouteId();
  const { kind, events } = useEvents();
  const event = useCurrentEvent();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (event) rememberEvent(event.routeId);
  }, [event]);

  if (kind === 'loading') return <PageState kind="loading" title="Loading the event…" />;
  const first = events[0];
  if (!event && routeId === DEMO_ROUTE_ID && first) {
    const screen = pathname.split('/').slice(3).join('/');
    return <Navigate to={`${eventPath(first.routeId, screen)}${search}`} replace />;
  }
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
