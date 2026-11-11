import { z } from 'zod';
import { Id } from './common.js';

// What a plan task is: work to do (book AV, print signage), a payment (venue deposit, pay the printer), or a milestone,
// a moment with no duration that the event's run-up hinges on (final confirmations, load-in, rehearsal, event day).
export const TaskKind = z.enum(['task', 'payment', 'milestone']);
export type TaskKind = z.infer<typeof TaskKind>;

// The part of the event a task belongs to, so the plan reads as workstreams rather than one list of payments.
export const Workstream = z.enum([
  'venue',
  'catering',
  'swag',
  'av',
  'printing',
  'photo_video',
  'prizes',
  'people',
  'sponsors',
]);
export type Workstream = z.infer<typeof Workstream>;

// One task of an event's plan, as stored. Dates are ISO timestamps. dependsOn lists the ids of tasks that must finish first.
// invoiceOfSponsorId marks the task that stands for that sponsor's PayPal invoice; fundedBySponsorId labels a purchase
// with the sponsor whose money covers it (a label only: nothing waits on a sponsor). workstream is null when unknown.
export const PlanTaskRow = z.object({
  id: Id,
  name: z.string().min(1),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  deadline: z.iso.datetime().nullable(),
  dependsOn: z.array(Id),
  fundedBySponsorId: Id.nullable(),
  invoiceOfSponsorId: Id.nullable(),
  kind: TaskKind,
  workstream: Workstream.nullable(),
});
export type PlanTaskRow = z.infer<typeof PlanTaskRow>;

// GET /api/events/:id/plan: the event's own tasks, soonest first. Empty until the planning agent (or a seed) adds some.
export const PlanResponse = z.object({
  eventDate: z.iso.datetime(),
  tasks: z.array(PlanTaskRow),
});
export type PlanResponse = z.infer<typeof PlanResponse>;
