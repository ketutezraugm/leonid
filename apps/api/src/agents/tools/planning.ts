import { tool } from 'ai';
import { z } from 'zod';
import { createTasks, linkTaskToSponsor } from '../../db/tasks.js';
import { auditedExecute, requireEvent, type AgentContext } from '../context.js';

const Day = z.iso.date().describe('YYYY-MM-DD');
const reason = z.string().max(300).optional().describe('One sentence: why');

const CreateTasksInput = z.object({
  tasks: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        start: Day,
        end: Day,
        deadline: Day.optional(),
        dependsOnNames: z
          .array(z.string())
          .optional()
          .describe('Names of existing or earlier-listed tasks that must finish first'),
      }),
    )
    .min(1)
    .max(20),
  reason,
});

// Writes go through db/tasks.ts, the same functions human edits will use (bryntum.md).
export function createTasksTool(ctx: AgentContext) {
  return tool({
    description:
      'Add tasks to the event plan with start/end dates, optional deadlines and dependencies. ' +
      'Include lead times (for example swag needs weeks to ship). Dates must be before the event day.',
    inputSchema: CreateTasksInput,
    execute: auditedExecute(ctx, 'planning', 'create_tasks', async ({ tasks }) => {
      const created = await createTasks(
        ctx.db,
        requireEvent(ctx),
        tasks.map((t) => ({
          name: t.name,
          start: new Date(t.start),
          end: new Date(t.end),
          deadline: t.deadline ? new Date(t.deadline) : null,
          dependsOnNames: t.dependsOnNames,
        })),
      );
      return { created: created.map((t) => t.name) };
    }),
  });
}

const LinkInput = z.object({
  taskName: z.string(),
  sponsorName: z.string().describe('Exact sponsor name from read_event'),
  reason,
});

export function linkTaskToInvoiceTool(ctx: AgentContext) {
  return tool({
    description:
      'Gate a task on a sponsor: it cannot be funded until that sponsor invoice is paid.',
    inputSchema: LinkInput,
    execute: auditedExecute(ctx, 'planning', 'link_task_to_invoice', async (input) => {
      const { task, sponsor } = await linkTaskToSponsor(
        ctx.db,
        requireEvent(ctx),
        input.taskName,
        input.sponsorName,
      );
      return { task: task.name, fundedBy: sponsor.name, sponsorStatus: sponsor.status };
    }),
  });
}
