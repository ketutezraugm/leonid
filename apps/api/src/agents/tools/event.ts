import { tool } from 'ai';
import { z } from 'zod';
import { createEventForThread, getEvent, listSponsors } from '../../db/events.js';
import { listTasks } from '../../db/tasks.js';
import { auditedExecute, todayIso, type AgentContext } from '../context.js';

const Input = z.object({
  reason: z.string().max(300).optional().describe('One sentence: why you need this'),
});

// Read-only snapshot of this chat's event only. Unlocked budget is deliberately absent until the
// funds-gated budget (money-safety.md) exists: pledged and invoiced money is never spendable.
export function readEventTool(ctx: AgentContext, actor: string) {
  return tool({
    description:
      "Read this chat's event: name, date, headcount, total budget, sponsors (pledged amount and " +
      'invoice status) and plan tasks. Amounts are integer cents. It does NOT include unlocked ' +
      'budget or cleared income; do not state those figures. Returns event: null when this chat ' +
      'has no event yet.',
    inputSchema: Input,
    execute: auditedExecute(ctx, actor, 'read_event', async () => {
      if (!ctx.eventId) {
        return {
          event: null,
          note: 'This chat has no event yet. Other chats and their events are not visible here.',
        };
      }
      const event = await getEvent(ctx.db, ctx.eventId);
      if (!event) throw new Error('Event not found');
      const [sponsors, tasks] = await Promise.all([
        listSponsors(ctx.db, ctx.eventId),
        listTasks(ctx.db, ctx.eventId),
      ]);
      const nameById = new Map(tasks.map((t) => [t.id, t.name]));
      return {
        event: {
          name: event.name,
          date: event.date.toISOString().slice(0, 10),
          headcount: event.headcount,
          budgetTotalCents: event.budgetTotal,
          currency: event.currency,
        },
        sponsors: sponsors.map((s) => ({
          name: s.name,
          tier: s.tier,
          pledgedCents: s.pledged,
          status: s.status,
        })),
        tasks: tasks.map((t) => ({
          name: t.name,
          start: t.start.toISOString().slice(0, 10),
          end: t.end.toISOString().slice(0, 10),
          deadline: t.deadline?.toISOString().slice(0, 10) ?? null,
          dependsOn: t.dependsOn.map((id) => nameById.get(id) ?? id),
          fundedBySponsor: sponsors.find((s) => s.id === t.fundedBySponsorId)?.name ?? null,
        })),
      };
    }),
  });
}

const CreateEventInput = z.object({
  name: z.string().trim().min(1).max(120),
  date: z.iso.date().describe('Event day, YYYY-MM-DD'),
  headcount: z.number().int().positive().max(100_000),
  budgetTotalCents: z
    .number()
    .int()
    .nonnegative()
    .describe('Planned total budget in minor units (cents). A target, not spendable money.'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD')
    .describe('ISO 4217 code'),
  reason: z.string().max(300).optional().describe('One sentence: why'),
});

// Gives a chat with no event its own one. It cannot replace an event a chat already has.
export function createEventTool(ctx: AgentContext) {
  return tool({
    description:
      'Create the event this chat is about, when read_event shows the chat has none and the ' +
      'organizer described a new event. Use only details the organizer gave; use ask_user for a ' +
      'missing date, headcount or budget instead of guessing. Fails if the chat already has an event.',
    inputSchema: CreateEventInput,
    execute: auditedExecute(ctx, 'orchestrator', 'create_event', async (input) => {
      // A past date is a misread ("7 November" taken as last year), so fail loudly for the model.
      if (input.date < todayIso(ctx)) {
        throw new Error(
          `${input.date} is in the past (today is ${todayIso(ctx)}). Use the next such date.`,
        );
      }
      const event = await createEventForThread(ctx.db, ctx.threadId, {
        name: input.name,
        date: new Date(input.date),
        headcount: input.headcount,
        budgetTotal: input.budgetTotalCents,
        currency: input.currency,
      });
      ctx.eventId = event.id;
      return { event: { id: event.id, name: event.name } };
    }),
  });
}
