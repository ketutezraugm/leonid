import { lazy, Suspense } from 'react';
import type { PlanEvent } from './planEvents';

// Bryntum Calendar is a large bundle, so it loads only when a screen with a plan shows it. Home and the Plan page
// both render it through here, so the two calendars are the same component on the same data.
const BryntumPlanCalendar = lazy(() => import('./BryntumPlanCalendar'));

export function PlanCalendarPanel({
  events,
  eventDate,
}: {
  events: PlanEvent[];
  eventDate: string;
}) {
  return (
    <Suspense
      fallback={
        <p className="muted" role="status">
          Loading the calendar…
        </p>
      }
    >
      <BryntumPlanCalendar events={events} eventDate={eventDate} />
    </Suspense>
  );
}
