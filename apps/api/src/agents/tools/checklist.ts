import { tool } from 'ai';
import { z } from 'zod';
import { ChecklistItem } from '@leonid/shared';
import { replaceChecklist } from '../../db/mandates.js';
import { auditedExecute, type AgentContext } from '../context.js';

const Input = z.object({
  items: z
    .array(ChecklistItem)
    .min(1)
    .max(12)
    .describe('The full checklist, in order. Replaces the previous list.'),
  reason: z.string().max(300).optional().describe('One sentence: why the list changed'),
});

// The mandate's checklist: write it first, then resend it with updated statuses after each item.
export function updateChecklistTool(ctx: AgentContext) {
  return tool({
    description:
      'Create or update the checklist for the current goal. Send the FULL list each time. ' +
      'Statuses: pending, in_progress, done, blocked. Use blocked (with blockedOn) when something ' +
      'outside your control must happen first, such as a sponsor invoice being paid.',
    inputSchema: Input,
    execute: auditedExecute(ctx, 'orchestrator', 'update_checklist', async ({ items }) => {
      const { status } = await replaceChecklist(ctx.db, {
        threadId: ctx.threadId,
        eventId: ctx.eventId,
        goal: ctx.goal,
        items,
      });
      return { items, mandateStatus: status };
    }),
  });
}
