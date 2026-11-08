import { z } from 'zod';
import { Id } from './common.js';

// One task of an event's plan, as stored. Dates are ISO timestamps. dependsOn lists the ids of tasks that must finish first.
// invoiceOfSponsorId marks the task that stands for that sponsor's PayPal invoice; fundedBySponsorId labels a purchase
// with the sponsor whose money covers it (a label only: nothing waits on a sponsor).
export const PlanTaskRow = z.object({
  id: Id,
  name: z.string().min(1),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  deadline: z.iso.datetime().nullable(),
  dependsOn: z.array(Id),
  fundedBySponsorId: Id.nullable(),
  invoiceOfSponsorId: Id.nullable(),
});
export type PlanTaskRow = z.infer<typeof PlanTaskRow>;

// GET /api/events/:id/plan: the event's own tasks, soonest first. Empty until the planning agent (or a seed) adds some.
export const PlanResponse = z.object({
  eventDate: z.iso.datetime(),
  tasks: z.array(PlanTaskRow),
});
export type PlanResponse = z.infer<typeof PlanResponse>;
