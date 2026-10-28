import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatThreadResponse } from '@quartermaster/shared';
import { createApp } from '../app.js';
import { AgentNotConfiguredError, chatModel } from '../agents/model.js';
import { scriptedModel, type ScriptStep } from '../agents/testing.js';
import { DbNotConfiguredError, getDb, type Db } from '../db/client.js';
import { getThread } from '../db/mandates.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { createChatRouter } from './chat.js';
import { createRateLimiter } from './rateLimit.js';

// Agent tests mock the model and use an in-memory DB: pnpm test never calls a real LLM or Supabase.
vi.mock('../agents/model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents/model.js')>()),
  chatModel: vi.fn(),
}));
vi.mock('../db/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/client.js')>()),
  getDb: vi.fn(),
}));

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  vi.mocked(getDb).mockReturnValue(db);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function userMessage(text: string, threadId = crypto.randomUUID()) {
  return {
    threadId,
    message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] },
  };
}

function useScript(script: ScriptStep[]) {
  const model = scriptedModel(script);
  vi.mocked(chatModel).mockReturnValue(model);
  return model;
}

async function loadThread(app: express.Express, threadId: string) {
  const res = await request(app).get(`/api/chat/${threadId}`);
  expect(res.status).toBe(200);
  return ChatThreadResponse.parse(res.body);
}

describe('POST /api/chat', () => {
  it('streams the reply and saves the thread', async () => {
    await seedDemoEvent(db);
    useScript([{ text: 'Nothing is unlocked until a sponsor pays.' }]);
    const app = createApp();
    const body = userMessage('How much budget is unlocked?');

    const res = await request(app).post('/api/chat').send(body);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('Nothing is unlocked until a sponsor pays.');

    await vi.waitFor(async () => {
      const thread = await loadThread(app, body.threadId);
      expect(thread.messages).toHaveLength(2);
    });
  });

  it('persists the checklist the agent writes and returns it on reload', async () => {
    await seedDemoEvent(db);
    useScript([
      {
        tool: 'update_checklist',
        input: { items: [{ title: 'Find lanyards', status: 'in_progress' }] },
      },
      { text: 'On it.' },
    ]);
    const app = createApp();
    const body = userMessage('Find lanyards');

    const res = await request(app).post('/api/chat').send(body);
    expect(res.status).toBe(200);
    expect(res.text).toContain('update_checklist');

    await vi.waitFor(async () => {
      const thread = await loadThread(app, body.threadId);
      expect(thread.checklist).toEqual([{ title: 'Find lanyards', status: 'in_progress' }]);
      expect(thread.messages).toHaveLength(2);
    });
  });

  it('sends earlier messages of the same thread to the model', async () => {
    await seedDemoEvent(db);
    const app = createApp();
    const first = userMessage('My code word is pineapple');

    useScript([{ text: 'Noted.' }]);
    await request(app).post('/api/chat').send(first);
    await vi.waitFor(async () =>
      expect((await loadThread(app, first.threadId)).messages).toHaveLength(2),
    );

    const model = useScript([{ text: 'Pineapple.' }]);
    await request(app).post('/api/chat').send(userMessage('What is my code word?', first.threadId));
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('pineapple');
  });

  it('rejects an invalid body', async () => {
    const app = createApp();
    expect((await request(app).post('/api/chat').send({})).status).toBe(400);
    expect((await request(app).post('/api/chat').send(userMessage('   '))).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/chat')
          .send({ ...userMessage('hi'), threadId: 'nope' })
      ).status,
    ).toBe(400);
  });

  it('returns 503 when no model is configured', async () => {
    vi.mocked(chatModel).mockImplementation(() => {
      throw new AgentNotConfiguredError('missing key');
    });
    const res = await request(createApp()).post('/api/chat').send(userMessage('Hi'));
    expect(res.status).toBe(503);
  });

  it('returns 503 when the database is not configured', async () => {
    useScript([{ text: 'x' }]);
    vi.mocked(getDb).mockImplementation(() => {
      throw new DbNotConfiguredError('missing url');
    });
    const res = await request(createApp()).post('/api/chat').send(userMessage('Hi'));
    expect(res.status).toBe(503);
  });

  it('works with no event seeded: a new chat starts without one', async () => {
    useScript([{ text: 'Tell me about your event.' }]);
    const body = userMessage('Hi');
    const res = await request(createApp()).post('/api/chat').send(body);
    expect(res.status).toBe(200);
    expect((await getThread(db, body.threadId))?.eventId).toBeNull();
  });

  it('rate limits per client', async () => {
    await seedDemoEvent(db);
    useScript([{ text: 'ok' }]);
    const app = express();
    app.use(express.json());
    app.use(
      '/api/chat',
      createChatRouter({ limiter: createRateLimiter({ max: 1, windowMs: 60_000 }) }),
    );

    expect((await request(app).post('/api/chat').send(userMessage('one'))).status).toBe(200);
    const limited = await request(app).post('/api/chat').send(userMessage('two'));
    expect(limited.status).toBe(429);
  });
});

describe('chat event scope', () => {
  const newMeetup = {
    tool: 'create_event',
    input: {
      name: 'Yogyakarta meetup',
      date: '2027-02-06',
      headcount: 80,
      budgetTotalCents: 150_000,
      currency: 'USD',
    },
  };

  // The bug this guards: tasks planned in one chat showed up in every new chat.
  it("does not show one chat's event or tasks to a new chat", async () => {
    await seedDemoEvent(db);
    const app = createApp();
    const first = userMessage('Plan a meetup in Yogyakarta for 80 people');
    useScript([
      newMeetup,
      { tool: 'delegate_to_planning', input: { task: 'Plan the venue' } },
      {
        tool: 'create_tasks',
        input: { tasks: [{ name: 'Book Yogyakarta venue', start: '2027-01-04', end: '2027-01-10' }] },
      },
      { text: 'Added the venue task.' },
      { text: 'Your meetup is set up.' },
    ]);
    await request(app).post('/api/chat').send(first);
    await vi.waitFor(async () =>
      expect((await loadThread(app, first.threadId)).event?.name).toBe('Yogyakarta meetup'),
    );

    const model = useScript([{ tool: 'read_event', input: {} }, { text: 'No event yet.' }]);
    await request(app).post('/api/chat').send(userMessage('Plan a new event'));

    const seen = JSON.stringify(model.doStreamCalls.at(-1)?.prompt);
    expect(seen).toContain('"event":null');
    expect(seen).not.toContain('Yogyakarta');
    expect(seen).not.toContain('OpenHack');
  });

  it('links a new chat to an existing event only when asked', async () => {
    const demo = await seedDemoEvent(db);
    const app = createApp();
    const body = { ...userMessage('Check my event'), eventId: demo.id };
    const model = useScript([{ tool: 'read_event', input: {} }, { text: 'OpenHack is set.' }]);

    expect((await request(app).post('/api/chat').send(body)).status).toBe(200);
    expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).toContain('OpenHack 2027');
    expect((await loadThread(app, body.threadId)).event).toEqual({
      id: demo.id,
      name: 'OpenHack 2027',
    });
  });

  it('ignores eventId for an existing thread and rejects an unknown event', async () => {
    const demo = await seedDemoEvent(db);
    const app = createApp();
    const body = userMessage('Hi');
    useScript([{ text: 'ok' }]);
    await request(app).post('/api/chat').send(body);
    await vi.waitFor(async () =>
      expect((await loadThread(app, body.threadId)).messages).toHaveLength(2),
    );

    useScript([{ text: 'ok' }]);
    await request(app)
      .post('/api/chat')
      .send({ ...userMessage('Use OpenHack', body.threadId), eventId: demo.id });
    expect((await getThread(db, body.threadId))?.eventId).toBeNull();

    const unknown = { ...userMessage('Hi'), eventId: crypto.randomUUID() };
    expect((await request(app).post('/api/chat').send(unknown)).status).toBe(400);
  });
});

describe('GET /api/chat/:threadId', () => {
  it('returns an empty thread for an unknown id', async () => {
    const thread = await loadThread(createApp(), crypto.randomUUID());
    expect(thread).toEqual({ messages: [], checklist: [], event: null });
  });

  it('rejects a malformed id', async () => {
    expect((await request(createApp()).get('/api/chat/not-a-uuid')).status).toBe(400);
  });
});

describe('chat sessions', () => {
  async function sendOne(app: express.Express, text: string) {
    useScript([{ text: 'ok' }]);
    const body = userMessage(text);
    await request(app).post('/api/chat').send(body);
    await vi.waitFor(async () => {
      expect((await loadThread(app, body.threadId)).messages).toHaveLength(2);
    });
    return body.threadId;
  }

  const lookup = (app: express.Express, ids: string[]) =>
    request(app).post('/api/chat/threads/lookup').send({ ids });

  it('titles a thread from its first message and lists only the requested ids, newest first', async () => {
    await seedDemoEvent(db);
    const app = createApp();
    const first = await sendOne(app, 'Plan swag for OpenHack');
    const second = await sendOne(app, 'How much budget is unlocked?');
    await sendOne(app, 'Someone else’s chat');

    const res = await lookup(app, [first, second, crypto.randomUUID()]);
    expect(res.status).toBe(200);
    expect(res.body.threads.map((t: { id: string }) => t.id)).toEqual([second, first]);
    expect(res.body.threads[1].title).toBe('Plan swag for OpenHack');
    expect(res.body.threads[1].event).toBeNull();
    expect(res.body.demoEvent.name).toBe('OpenHack 2027');
  });

  it('leaves out archived threads, which still open by id', async () => {
    await seedDemoEvent(db);
    const app = createApp();
    const id = await sendOne(app, 'Find lanyards');

    expect((await request(app).patch(`/api/chat/${id}`).send({ archived: true })).status).toBe(204);
    expect((await lookup(app, [id])).body.threads).toEqual([]);
    expect((await loadThread(app, id)).messages).toHaveLength(2);

    await request(app).patch(`/api/chat/${id}`).send({ archived: false });
    expect((await lookup(app, [id])).body.threads).toHaveLength(1);
  });

  it('renames a thread', async () => {
    await seedDemoEvent(db);
    const app = createApp();
    const id = await sendOne(app, 'Find lanyards');

    await request(app).patch(`/api/chat/${id}`).send({ title: '  Swag run ' });
    expect((await lookup(app, [id])).body.threads[0].title).toBe('Swag run');
  });

  it('rejects bad requests and unknown threads', async () => {
    const app = createApp();
    expect((await lookup(app, [])).status).toBe(400);
    expect((await lookup(app, ['nope'])).status).toBe(400);
    expect((await request(app).patch('/api/chat/nope').send({ title: 'x' })).status).toBe(400);
    const id = crypto.randomUUID();
    expect((await request(app).patch(`/api/chat/${id}`).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/chat/${id}`).send({ title: 'x' })).status).toBe(404);
  });
});
