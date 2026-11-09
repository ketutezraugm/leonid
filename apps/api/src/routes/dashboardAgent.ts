import { DashboardAgentTurnRequest, DashboardAgentTurnResponse, type DashboardAgentItem } from '@quartermaster/shared';
import { generateText, jsonSchema, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import express, { Router } from 'express';
import { AgentNotConfiguredError, chatModel } from '../agents/model.js';
import { requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { writeAudit } from '../db/audit.js';
import { getDb, type Db } from '../db/client.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';

// F21, the dashboard agent's model turns. AG Studio's agent harness (the Leonid analyst and AG's own five
// agents) runs in the browser, so this route is its LLM: one turn in, the model's text and tool calls out.
// It runs no tool. The tools are the ones the browser lists, Studio's dashboard tools (view, query, add or
// arrange a widget), and Studio runs them against the dashboard. No tool can move money: there is no spend,
// payout or PayPal tool in the browser to list (invariant 4), and this route adds none.
// Treasurer-only and rate-limited, because every call spends model credit.

export interface DashboardAgentRouterOptions {
  env?: NodeJS.ProcessEnv;
  model?: () => LanguageModel;
  db?: () => Db;
  limiter?: RateLimiter;
}

const contentText = (content: Extract<DashboardAgentItem, { type: 'message' }>['content']) =>
  content
    .map((c) => c.text ?? c.refusal ?? '')
    .filter(Boolean)
    .join('\n');

// A tool call's arguments as an object; arguments the model wrote badly count as none.
function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

// AG Studio's conversation items as the AI SDK's messages. A tool result needs the tool's name, which only
// the call carries, so calls are remembered by id. Reasoning items are the model's own and are not sent back.
export function toModelMessages(items: DashboardAgentItem[]): ModelMessage[] {
  const names = new Map<string, string>();
  const messages: ModelMessage[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'message': {
        const text = contentText(item.content);
        if (!text) break;
        if (item.role === 'assistant') messages.push({ role: 'assistant', content: text });
        else if (item.role === 'system') messages.push({ role: 'system', content: text });
        else messages.push({ role: 'user', content: text });
        break;
      }
      case 'function_call': {
        names.set(item.callId, item.name);
        const input = parseArguments(item.arguments);
        messages.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: item.callId, toolName: item.name, input }] });
        break;
      }
      case 'function_call_output':
        messages.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: item.callId,
              toolName: names.get(item.callId) ?? 'unknown',
              output: { type: 'text', value: item.output },
            },
          ],
        });
        break;
      case 'reasoning':
        break;
    }
  }
  return messages;
}

export function dashboardAgentRouter(options: DashboardAgentRouterOptions = {}) {
  const guard = requireTreasurer(options.env ?? process.env);
  const limiter = options.limiter ?? createRateLimiter({ max: 60, windowMs: 10 * 60_000 });
  const router = Router();

  router.post('/turn', guard, express.json({ limit: '2mb' }), async (req, res) => {
    if (!limiter.take(req)) {
      res.status(429).json({ error: 'The dashboard agent is busy; try again in a few minutes' });
      return;
    }
    const body = DashboardAgentTurnRequest.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ error: 'invalid turn', issues: body.error.issues });
      return;
    }
    let model: LanguageModel;
    try {
      model = (options.model ?? chatModel)();
    } catch (err) {
      if (err instanceof AgentNotConfiguredError) {
        res.status(503).json({ error: 'The dashboard agent has no model configured' });
        return;
      }
      throw err;
    }
    // Declared only, never executed here: the model returns its calls and Studio runs them.
    const tools: ToolSet = Object.fromEntries(
      body.data.tools.map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(t.parameters) })]),
    );
    try {
      const result = await generateText({
        model,
        system: body.data.instructions,
        messages: toModelMessages(body.data.input),
        tools,
        toolChoice: body.data.toolChoice,
        abortSignal: AbortSignal.timeout(90_000),
      });
      const answer = DashboardAgentTurnResponse.parse({
        text: result.text,
        toolCalls: result.toolCalls.map((c) => ({
          callId: c.toolCallId,
          name: c.toolName,
          arguments: JSON.stringify(c.input ?? {}),
        })),
        model: result.response?.modelId ?? null,
        usage:
          result.usage?.inputTokens !== undefined && result.usage.outputTokens !== undefined
            ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
            : null,
      });
      // Invariant 7: the agent's actions are audited. The dashboard agent's are reads and widget changes,
      // so the row names the tools it asked for, not their (possibly large) arguments.
      try {
        await writeAudit((options.db ?? getDb)(), {
          actor: 'dashboard-agent',
          action: 'dashboard_agent.turn',
          input: { treasurer: treasurerActor(res), tools: body.data.tools.length, calls: answer.toolCalls.map((c) => c.name) },
          reason: answer.text.slice(0, 500),
        });
      } catch {
        // No database (local runs without one): the turn still answers.
      }
      res.json(answer);
    } catch (err) {
      console.error('dashboard agent turn failed:', err instanceof Error ? err.name : 'error');
      res.status(502).json({ error: 'The model did not answer' });
    }
  });

  return router;
}
