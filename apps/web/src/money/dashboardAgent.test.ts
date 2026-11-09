import type { AgLlmRequest } from 'ag-studio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leonidAdapter, turnEvents, turnOutput } from './dashboardAgent';

const turn = {
  text: 'Swag is under its cap.',
  toolCalls: [{ callId: 'c1', name: 'execute_query', arguments: '{"fields":["spent"]}' }],
  model: 'test-model',
  usage: { inputTokens: 10, outputTokens: 5 },
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('the dashboard agent adapter (F21)', () => {
  it('replays a turn as one text message and one start/args/end per tool call', () => {
    expect(turnEvents(turn, 'm1').map((e) => e.type)).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
    ]);
    expect(turnOutput(turn, 'm1')).toEqual([
      expect.objectContaining({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Swag is under its cap.', annotations: [] }] }),
      expect.objectContaining({ type: 'function_call', callId: 'c1', name: 'execute_query', arguments: '{"fields":["spent"]}' }),
    ]);
  });

  it('asks our API, never a model provider, and sends only client tools', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(json(turn));
    });
    vi.stubGlobal('fetch', fetchMock);

    const handler = leonidAdapter.executeTurn({
      input: [],
      instructions: 'be brief',
      tools: [
        { name: 'execute_query', description: 'q', parameters: { type: 'object' } },
        { name: 'web_search', description: 'w', parameters: { type: 'object' }, kind: 'provided' },
      ],
    } as unknown as AgLlmRequest);
    const events = [];
    for await (const e of handler.stream) events.push(e);
    const done = await handler.complete;

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/dashboard-agent/turn');
    expect(JSON.parse(String(init?.body)).tools.map((t: { name: string }) => t.name)).toEqual(['execute_query']);
    expect(events).toHaveLength(6);
    expect(done).toMatchObject({ status: 'completed', model: 'test-model' });
  });

  it('reports a failed turn instead of throwing, with no events', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ error: 'The dashboard agent is busy' }, 429))));

    const handler = leonidAdapter.executeTurn({ input: [] } as unknown as AgLlmRequest);
    const events = [];
    for await (const e of handler.stream) events.push(e);

    expect(events).toEqual([]);
    expect(await handler.complete).toMatchObject({ status: 'failed', error: { code: '429', message: 'The dashboard agent is busy' } });
  });
});
