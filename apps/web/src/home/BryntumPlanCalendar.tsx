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
import { KIND_ICON } from '../plan/workstreams';
import { calendarDate, eventDayRange, type PlanEvent } from './planEvents';

// Loaded lazily from Home: the trial bundle is large and unminified, like the Gantt's. Read-only: the plan is
// changed through the agent and the Plan page, never by dragging an event here.
// Says which sponsor funds a purchase, after its name, and marks a milestone with a diamond and a payment with a dollar
// sign. Returned as text, never as HTML, because names come from data.
const eventRenderer = ({
  eventRecord,
}: {
  eventRecord: { name?: string; get: (field: string) => unknown };
}) => {
  const funding = eventRecord.get('funding');
  const kind = eventRecord.get('kind');
  const icon = kind === 'milestone' || kind === 'payment' ? KIND_ICON[kind] : null;
  const text =
    typeof funding === 'string' && funding
      ? `${eventRecord.name} · ${funding}`
      : (eventRecord.name ?? '');
  const label = { tag: 'span', text };
  return {
    tag: 'span',
    children: icon
      ? [{ tag: 'i', className: `fa-solid ${icon} lx-kind-icon`, 'aria-hidden': 'true' }, label]
      : [label],
  };
};

export type CalendarMode = 'day' | 'week' | 'month';
/** What fills an event: its status (late, at risk, done…) or its workstream (venue, AV, printing…). */
export type CalendarColorBy = 'status' | 'workstream';

function BryntumPlanCalendar({
  events,
  eventDate,
  mode = 'month',
  colorBy = 'status',
}: {
  events: PlanEvent[];
  eventDate: string;
  /** The view it opens on. */
  mode?: CalendarMode;
  colorBy?: CalendarColorBy;
}) {
  return (
    <div className={`lx-calendar lx-color-${colorBy}`}>
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
  (a, b) =>
    a.events === b.events &&
    a.eventDate === b.eventDate &&
    a.mode === b.mode &&
    a.colorBy === b.colorBy,
);
