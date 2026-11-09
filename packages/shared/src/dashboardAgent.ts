import { z } from 'zod';

// F21, the dashboard agent. AG Studio's agent harness runs in the browser and asks our API for one model
// turn at a time (the model key never reaches the browser). The API returns what the model said and which
// dashboard tools it wants called; Studio runs those tools itself, against the dashboard only. Nothing here
// can move money: the only tools are Studio's own (view, query, add or arrange widgets).

const Text = z.string().max(200_000);

// One item of the conversation, in AG Studio's shape (an OpenAI-Responses-like item list).
export const DashboardAgentItem = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('message'),
    role: z.enum(['user', 'system', 'assistant']),
    content: z.array(z.looseObject({ type: z.string(), text: Text.optional(), refusal: Text.optional() })).max(50),
  }),
  z.looseObject({ type: z.literal('function_call'), callId: z.string().min(1).max(200), name: z.string().min(1).max(100), arguments: Text }),
  z.looseObject({ type: z.literal('function_call_output'), callId: z.string().min(1).max(200), output: Text }),
  z.looseObject({ type: z.literal('reasoning') }),
]);
export type DashboardAgentItem = z.infer<typeof DashboardAgentItem>;

export const DashboardAgentTool = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  description: z.string().max(10_000),
  parameters: z.record(z.string(), z.unknown()),
});
export type DashboardAgentTool = z.infer<typeof DashboardAgentTool>;

// POST /api/dashboard-agent/turn (treasurer)
export const DashboardAgentTurnRequest = z.object({
  input: z.array(DashboardAgentItem).max(200),
  instructions: z.string().max(50_000).optional(),
  tools: z.array(DashboardAgentTool).max(40).default([]),
  toolChoice: z.enum(['auto', 'none', 'required']).optional(),
});
export type DashboardAgentTurnRequest = z.infer<typeof DashboardAgentTurnRequest>;

export const DashboardAgentTurnResponse = z.object({
  text: z.string(),
  toolCalls: z.array(z.object({ callId: z.string().min(1), name: z.string().min(1), arguments: z.string() })),
  model: z.string().nullable(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).nullable(),
});
export type DashboardAgentTurnResponse = z.infer<typeof DashboardAgentTurnResponse>;
