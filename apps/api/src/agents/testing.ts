import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

// Test-only. A scripted model: each model call (streamed or not) consumes the next step, so one
// script can cover an orchestrator and the subagents it calls, in order. No real LLM is involved.
export type ScriptStep = { text: string } | { tool: string; input: unknown };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export function scriptedModel(script: ScriptStep[], { repeatLast = false } = {}) {
  let calls = 0;
  const next = (): ScriptStep => {
    const step = script[Math.min(calls, repeatLast ? script.length - 1 : calls)];
    calls += 1;
    if (!step) throw new Error(`Script exhausted after ${script.length} model calls`);
    return step;
  };
  const finishReason = (step: ScriptStep) => ({
    unified: 'tool' in step ? ('tool-calls' as const) : ('stop' as const),
    raw: undefined,
  });

  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const step = next();
      return {
        content:
          'tool' in step
            ? [
                {
                  type: 'tool-call' as const,
                  toolCallId: `call-${calls}`,
                  toolName: step.tool,
                  input: JSON.stringify(step.input),
                },
              ]
            : [{ type: 'text' as const, text: step.text }],
        finishReason: finishReason(step),
        usage,
        warnings: [],
      };
    },
    doStream: async () => {
      const step = next();
      return {
        stream: simulateReadableStream({
          chunks: [
            ...('tool' in step
              ? [
                  {
                    type: 'tool-call' as const,
                    toolCallId: `call-${calls}`,
                    toolName: step.tool,
                    input: JSON.stringify(step.input),
                  },
                ]
              : [
                  { type: 'text-start' as const, id: 'text-1' },
                  { type: 'text-delta' as const, id: 'text-1', delta: step.text },
                  { type: 'text-end' as const, id: 'text-1' },
                ]),
            { type: 'finish' as const, finishReason: finishReason(step), usage },
          ],
        }),
      };
    },
  });
  return Object.assign(model, { callCount: () => calls });
}
