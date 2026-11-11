import { tool } from 'ai';
import { z } from 'zod';
import { AskUserInput } from '@leonid/shared';
import { auditedExecute, type AgentContext } from '../context.js';

export const ASK_USER_TOOL = 'ask_user';

const Input = AskUserInput.extend({
  reason: z.string().max(300).optional().describe('One sentence: why you need to ask'),
});

// Shows the organizer clarifying questions as choices. The run stops after this call (see the
// orchestrator's stopWhen); the answers arrive as the next user message.
export function askUserTool(ctx: AgentContext) {
  return tool({
    description:
      'Ask the organizer everything you are unsure about, all in ONE call: up to 4 questions, each ' +
      'with 2-4 options (put the one you recommend first). They can also write their own answer. ' +
      'Your turn ends after this call, so do not ask the same thing again in text.',
    inputSchema: Input,
    execute: auditedExecute(ctx, 'orchestrator', ASK_USER_TOOL, async ({ questions }) => ({
      asked: questions.length,
    })),
  });
}
