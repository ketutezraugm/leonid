import type { DependencyModelConfig } from '@bryntum/gantt';
import type { PlanResponse, PlanTaskRow } from '@quartermaster/shared';
import type { Status } from '../ui/StatusBadge';
import type { SourceTask } from './gating';

const DAY = 86_400_000;
// Two days or fewer to spare before a deadline is at risk; past it is late (the delivery-risk wording agreed with P3).
const RISK_DAYS = 2;

// A stored task has no status of its own: it follows the clock, and its deadline when it has one.
export function taskStatus(task: PlanTaskRow, now: Date): Status {
  const end = Date.parse(task.end);
  if (task.deadline) {
    const deadline = Date.parse(task.deadline);
    if (end > deadline) return 'blocked';
    if (end <= now.getTime()) return 'done';
    if (deadline - end <= RISK_DAYS * DAY) return 'risk';
  }
  if (end <= now.getTime()) return 'done';
  return Date.parse(task.start) <= now.getTime() ? 'progress' : 'pending';
}

export interface PlanSource {
  tasks: SourceTask[];
  dependencies: DependencyModelConfig[];
  /** The Gantt's visible range: the tasks and event day, with a week of margin before and two after. */
  startDate: string;
  endDate: string;
  eventDay: string;
}

const day = (iso: string) => iso.slice(0, 10);

export function planWindow(plan: PlanResponse): { start: number; end: number } {
  const starts = plan.tasks.map((t) => Date.parse(t.start));
  const ends = plan.tasks.map((t) => Date.parse(t.end));
  const event = Date.parse(plan.eventDate);
  return {
    start: Math.min(event, ...starts) - 7 * DAY,
    end: Math.max(event, ...ends) + 14 * DAY,
  };
}

export function toPlanSource(plan: PlanResponse, now = new Date()): PlanSource {
  const eventDay = day(plan.eventDate);
  const window = planWindow(plan);
  const known = new Set(plan.tasks.map((t) => t.id));
  return {
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      startDate: day(t.start),
      endDate: new Date(Date.parse(t.end) + 1000).toISOString().slice(0, 10),
      status: taskStatus(t, now),
      percentDone: taskStatus(t, now) === 'done' ? 100 : undefined,
      deadlineDate: t.deadline ? day(t.deadline) : undefined,
      // Pin each start date: otherwise the scheduler pulls a task with no predecessor to the project start.
      constraintType: 'startnoearlierthan',
      constraintDate: day(t.start),
      fundedBySponsorId: t.fundedBySponsorId,
      invoiceOfSponsorId: t.invoiceOfSponsorId ?? undefined,
    })),
    dependencies: plan.tasks.flatMap((t) =>
      t.dependsOn
        .filter((from) => known.has(from))
        .map((from) => ({ id: `${from}>${t.id}`, from, to: t.id })),
    ),
    startDate: new Date(window.start).toISOString().slice(0, 10),
    endDate: new Date(window.end).toISOString().slice(0, 10),
    eventDay,
  };
}
