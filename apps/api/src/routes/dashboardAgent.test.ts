import { DashboardAgentTurnResponse } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { scriptedModel } from '../agents/testing.js';
import { dashboardAgentRouter, toModelMessages } from './dashboardAgent.js';

const TREASURER = { 'x-treasurer-token': 'secret' };
const QUERY_TOOL = {
  name: 'execute_query',
  description: 'Run a query against the dashboard data',
  parameters: { type: 'object', properties: { fields: { type: 'array', items: { type: 'string' } } } },
};
const ask = (text: string) => ({ type: 'message', role: 'user', content: [{ type: 'text', text }] });

const appWith = (script: Parameters<typeof scriptedModel>[0], limiter = { take: () => true }) => {
  const app = express();
  app.use(
    '/api/dashboard-agent',
    dashboardAgentRouter({ env: { TREASURER_TOKEN: 'secret' }, model: () => scriptedModel(script), limiter, db: () => { throw new Error('no db'); } }),
  );
  return app;
};

describe('dashboard agent turns (F21)', () => {
  it('returns the tool calls the model asks for, without running any', async () => {
    const res = await request(appWith([{ tool: 'execute_query', input: { fields: ['category', 'spent'] } }]))
      .post('/api/dashboard-agent/turn')
      .set(TREASURER)
      .send({ input: [ask('Where are we overspending?')], tools: [QUERY_TOOL] });

    expect(res.status).toBe(200);
    const turn = DashboardAgentTurnResponse.parse(res.body);
    expect(turn.toolCalls).toEqual([{ callId: expect.any(String), name: 'execute_query', arguments: '{"fields":["category","spent"]}' }]);
  });

  it('returns the text of a plain answer', async () => {
    const res = await request(appWith([{ text: 'Swag is 80% of its cap.' }]))
      .post('/api/dashboard-agent/turn')
      .set(TREASURER)
      .send({ input: [ask('How is swag doing?')] });

    expect(DashboardAgentTurnResponse.parse(res.body)).toMatchObject({ text: 'Swag is 80% of its cap.', toolCalls: [] });
  });

  it('is treasurer-only, rate-limited, and checks its body', async () => {
    const app = appWith([{ text: 'x' }]);
    expect((await request(app).post('/api/dashboard-agent/turn').send({ input: [] })).status).toBe(401);
    expect((await request(app).post('/api/dashboard-agent/turn').set(TREASURER).send({ input: 'nope' })).status).toBe(422);
    const busy = appWith([{ text: 'x' }], { take: () => false });
    expect((await request(busy).post('/api/dashboard-agent/turn').set(TREASURER).send({ input: [] })).status).toBe(429);
  });

  it('answers 503 when no model is configured', async () => {
    const app = express();
    app.use('/api/dashboard-agent', dashboardAgentRouter({ env: { TREASURER_TOKEN: 'secret' }, limiter: { take: () => true } }));
    const saved = { key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    try {
      expect((await request(app).post('/api/dashboard-agent/turn').set(TREASURER).send({ input: [] })).status).toBe(503);
    } finally {
      if (saved.key) process.env.OPENROUTER_API_KEY = saved.key;
      if (saved.model) process.env.OPENROUTER_MODEL = saved.model;
    }
  });
});

describe('toModelMessages', () => {
  it("turns Studio's items into model messages, naming each tool result after its call", () => {
    const messages = toModelMessages([
      ask('Spend by sponsor?') as never,
      { type: 'function_call', callId: 'c1', name: 'execute_query', arguments: '{"a":1}' },
      { type: 'function_call_output', callId: 'c1', output: '[{"sponsor":"Harbor","spent":1400}]' },
      { type: 'reasoning' },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Harbor paid most.' }] },
    ]);

    expect(messages).toEqual([
      { role: 'user', content: 'Spend by sponsor?' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'execute_query', input: { a: 1 } }] },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'execute_query', output: { type: 'text', value: '[{"sponsor":"Harbor","spent":1400}]' } }],
      },
      { role: 'assistant', content: 'Harbor paid most.' },
    ]);
  });
});
