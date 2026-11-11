import { BryntumCalendar } from '@bryntum/calendar-react-thin';
import { memo } from 'react';
import '@bryntum/core-thin/fontawesome/css/fontawesome.css';
import '@bryntum/core-thin/fontawesome/css/solid.css';
import '@bryntum/core-thin/core.css';
import '@bryntum/grid-thin/grid.css';
import '@bryntum/scheduler-thin/scheduler.css';
import '@bryntum/calendar-thin/calendar.css';
import '@bryntum/core-thin/svalbard-light.css';
import './calendar-theme.css';
import { calendarDate, eventDayRange, type PlanEvent } from './planEvents';

// Loaded lazily from Home: the trial bundle is large and unminified, like the Gantt's. Read-only: the plan is
// changed through the agent and the Plan page, never by dragging an event here.
// Says which sponsor funds a purchase, after its name. Returned as text, never as HTML, because names come from data.
const eventRenderer = ({
  eventRecord,
}: {
  eventRecord: { name?: string; get: (field: string) => unknown };
}) => {
  const funding = eventRecord.get('funding');
  return {
    tag: 'span',
    text:
      typeof funding === 'string' && funding
        ? `${eventRecord.name} · ${funding}`
        : (eventRecord.name ?? ''),
  };
};

export type CalendarMode = 'day' | 'week' | 'month';

function BryntumPlanCalendar({
  events,
  eventDate,
  mode = 'month',
}: {
  events: PlanEvent[];
  eventDate: string;
  /** The view it opens on. */
  mode?: CalendarMode;
}) {
  return (
    <div className="lx-calendar">
      {/* Month cells carry their date, so the event day's cell is picked out by it (eventDate is an ISO timestamp). */}
      <style>{`.lx-calendar .b-calendar-cell[data-date="${eventDate.slice(0, 10)}"] { background: var(--color-brass-soft); box-shadow: inset 0 0 0 2px var(--color-brass); }`}</style>
      <BryntumCalendar
        date={calendarDate(eventDate)}
        mode={mode}
        modes={{
          day: { eventRenderer },
          week: { eventRenderer },
          month: { eventRenderer },
          year: null,
          agenda: null,
        }}
        sidebar={false}
        weekStartDay={1}
        readOnly
        events={events}
        timeRangesFeature
        timeRanges={[eventDayRange(eventDate)]}
      />
    </div>
  );
}

// Home re-renders as other cards load; the calendar only redraws when the plan's events change.
export default memo(
  BryntumPlanCalendar,
  (a, b) => a.events === b.events && a.eventDate === b.eventDate && a.mode === b.mode,
);
