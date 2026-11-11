import type { PlanResponse, TaskKind, Workstream } from '@leonid/shared';
import { taskStatus } from '../plan/fromApi';
import { fundingText, invoiceStatus, type PlanSponsor } from '../plan/gating';
import { workstreamSlug } from '../plan/workstreams';
import type { Status } from '../ui/StatusBadge';

// The event's stored plan as Bryntum Calendar events. A plan is stored in UTC. Times are handed over as plain wall-clock
// strings with no zone, so the calendar shows the same clock times whatever time zone the browser is in.
const DAY = 86_400_000;

export interface PlanEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  /** Lands on the event's element: its status and workstream classes, which calendar-theme.css colours by. */
  cls: string;
  status: Status;
  /** "Harbor Cloud · paid" for a purchase a sponsor funds; empty otherwise. */
  funding: string;
  kind: TaskKind;
  workstream: Workstream | null;
}

/** "2027-03-14T09:00:00": the UTC wall clock, which Bryntum reads as local time. */
export const wallClock = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;

// A task with no clock time (a day or longer, or a milestone at midnight) is an all-day event; the rest sit on the hour grid.
// Sponsors colour and label tasks as they did in the Gantt: a sponsor's invoice task follows that sponsor's status, and
// a purchase says which sponsor funds it and whether they have paid. Nothing waits on a sponsor (the gate was removed Nov 6).
export function toPlanEvents(
  plan: PlanResponse,
  now: Date,
  sponsors: PlanSponsor[] = [],
): PlanEvent[] {
  const byId = new Map(sponsors.map((sponsor) => [sponsor.id, sponsor]));
  return plan.tasks.map((task) => {
    const start = Date.parse(task.start);
    const end = Date.parse(task.end);
    const allDay = start === end ? start % DAY === 0 : end - start >= DAY - 1000;
    const invoiceOf = task.invoiceOfSponsorId ? byId.get(task.invoiceOfSponsorId) : undefined;
    const status = task.invoiceOfSponsorId
      ? invoiceOf
        ? invoiceStatus[invoiceOf.status]
        : 'pending'
      : taskStatus(task, now);
    const funder =
      !task.invoiceOfSponsorId && task.fundedBySponsorId
        ? byId.get(task.fundedBySponsorId)
        : undefined;
    // An all-day event ends at a midnight, exclusive: Mar 8 to Mar 10 at 00:00 covers the 8th and 9th.
    const allDayEnd = Math.max(
      end % DAY === 0 ? end : startOfDay(end) + DAY,
      startOfDay(start) + DAY,
    );
    return {
      id: task.id,
      name: task.name,
      startDate: wallClock(allDay ? startOfDay(start) : start),
      endDate: wallClock(allDay ? allDayEnd : end),
      allDay,
      cls: `lx-status-${status} lx-ws-${workstreamSlug(task.workstream)} lx-kind-${task.kind}`,
      status,
      funding: funder ? fundingText(funder.name, funder.status === 'paid') : '',
      kind: task.kind,
      workstream: task.workstream,
    };
  });
}

// "3 tasks late or at risk · Next: …" over the whole plan; the calendar shows the detail.
export function planSummary(events: Pick<PlanEvent, 'name' | 'status'>[]): {
  flagged: number;
  next: string[];
} {
  return {
    flagged: events.filter((e) => e.status === 'blocked' || e.status === 'risk').length,
    next: events
      .filter((e) => e.status !== 'done')
      .slice(0, 2)
      .map((e) => e.name),
  };
}

/** The event day as a plain wall-clock span, for the calendar's event-day highlight. */
export function eventDayRange(isoDate: string): {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
} {
  const start = startOfDay(Date.parse(isoDate));
  return {
    id: 'event-day',
    name: 'Event day',
    startDate: wallClock(start),
    endDate: wallClock(start + DAY),
  };
}

/** A Date whose local fields are the UTC day, matching the wall-clock strings above. */
export function calendarDate(isoDate: string): Date {
  const d = new Date(isoDate);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
