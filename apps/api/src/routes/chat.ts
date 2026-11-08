import { Router, type Response } from 'express';
import { pipeAgentUIStreamToResponse, validateUIMessages } from 'ai';
import { z } from 'zod';
import {
  AgentChatRequest,
  ChatThreadLookupRequest,
  ChatThreadPatchRequest,
  type ApiError,
  type ChatEventRef,
  type ChatThreadListResponse,
  type ChatThreadResponse,
} from '@quartermaster/shared';
import { createOrchestrator } from '../agents/orchestrator.js';
import { currentTreasurer, ownerOf, requireTreasurer } from '../auth/treasurer.js';
import { AgentNotConfiguredError, chatModel } from '../agents/model.js';
import { bookingChoiceOf } from '../agents/tools/bookings.js';
import { venuePickOf } from '../agents/venuePick.js';
import { bookingPayment, bookingPlanLine, bookingReference, bookingSummary, pickedListing } from '../booking/venueBooking.js';
import { DbNotConfiguredError, getDb, type Db } from '../db/client.js';
import { getDemoEvent, getEvent, getVisibleEvent } from '../db/events.js';
import {
  getChecklist,
  getOrCreateThread,
  getVisibleThread,
  saveMessages,
} from '../db/mandates.js';
import {
  deleteThread,
  listThreadSummaries,
  setTitleIfMissing,
  updateThread,
} from '../db/threads.js';
import { createCatalogSearchClient } from '../search/venueCatalog.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';

// Only the most recent messages go to the model; the full history stays in the thread.
const MODEL_WINDOW = 30;
const RUN_TIMEOUT_MS = 90_000;

const refOf = (event: { id: string; name: string } | undefined): ChatEventRef | null =>
  event ? { id: event.id, name: event.name } : null;

function fail(res: Response, status: number, error: string) {
  const body: ApiError = { error };
  res.status(status).json(body);
}

// True when the error was a not-configured one and a 503 has been sent.
function sendNotConfigured(res: Response, err: unknown) {
  if (err instanceof AgentNotConfiguredError) {
    fail(res, 503, 'The agent is not configured on this server.');
    return true;
  }
  if (err instanceof DbNotConfiguredError) {
    fail(res, 503, 'The database is not configured on this server.');
    return true;
  }
  return false;
}

// Treasurer only. Every chat belongs to the treasurer who started it: someone else's thread id answers like an unknown one.
export function createChatRouter({
  limiter = createRateLimiter({ max: 30, windowMs: 10 * 60_000 }),
  env = process.env,
}: { limiter?: RateLimiter; env?: NodeJS.ProcessEnv } = {}) {
  const router = Router();
  router.use(requireTreasurer(env));
  const ownerOfRequest = (res: Response) => ownerOf(currentTreasurer(res));

  // Registered before /:threadId so "threads" is never parsed as an id.
  router.post('/threads/lookup', async (req, res) => {
    const parsed = ChatThreadLookupRequest.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'Invalid request');
    try {
      const db = getDb();
      const [threads, demo] = await Promise.all([
        listThreadSummaries(db, parsed.data.ids, ownerOfRequest(res)),
        getDemoEvent(db),
      ]);
      const body: ChatThreadListResponse = { threads, demoEvent: refOf(demo) };
      res.json(body);
    } catch (err) {
      if (sendNotConfigured(res, err)) return;
      console.error('Listing chat threads failed', err);
      fail(res, 500, 'Could not load your chats.');
    }
  });

  router.patch('/:threadId', async (req, res) => {
    const threadId = z.uuid().safeParse(req.params.threadId);
    if (!threadId.success) return fail(res, 400, 'Invalid thread id');
    const patch = ChatThreadPatchRequest.safeParse(req.body);
    if (!patch.success) return fail(res, 400, 'Invalid request');
    try {
      const found = await updateThread(getDb(), threadId.data, patch.data, ownerOfRequest(res));
      if (!found) return fail(res, 404, 'Conversation not found');
      res.status(204).end();
    } catch (err) {
      if (sendNotConfigured(res, err)) return;
      console.error('Updating chat thread failed', err);
      fail(res, 500, 'Could not update the conversation.');
    }
  });

  router.delete('/:threadId', async (req, res) => {
    const threadId = z.uuid().safeParse(req.params.threadId);
    if (!threadId.success) return fail(res, 400, 'Invalid thread id');
    try {
      const found = await deleteThread(getDb(), threadId.data, ownerOfRequest(res));
      if (!found) return fail(res, 404, 'Conversation not found');
      res.status(204).end();
    } catch (err) {
      if (sendNotConfigured(res, err)) return;
      console.error('Deleting chat thread failed', err);
      fail(res, 500, 'Could not delete the conversation.');
    }
  });

  router.get('/:threadId', async (req, res) => {
    const threadId = z.uuid().safeParse(req.params.threadId);
    if (!threadId.success) return fail(res, 400, 'Invalid thread id');

    try {
      const db = getDb();
      const thread = await getVisibleThread(db, threadId.data, ownerOfRequest(res));
      const event = thread?.eventId ? await getEvent(db, thread.eventId) : undefined;
      const body: ChatThreadResponse = {
        messages: Array.isArray(thread?.messages) ? thread.messages : [],
        checklist: thread ? await getChecklist(db, thread.id) : [],
        event: refOf(event),
      };
      res.json(body);
    } catch (err) {
      if (sendNotConfigured(res, err)) return;
      console.error('Loading chat thread failed', err);
      fail(res, 500, 'Could not load the conversation.');
    }
  });

  router.post('/', async (req, res) => {
    const parsed = AgentChatRequest.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'Invalid chat request');
    if (!limiter.take(req)) {
      return fail(res, 429, 'Too many requests. Wait a few minutes and try again.');
    }
    const { threadId, message, eventId } = parsed.data;

    try {
      // Resolve config and history before streaming so failures can still be a clean status code.
      const model = chatModel();
      const db = getDb();

      // A chat sees only its own event: the one the user linked when starting it, or the one the
      // agent creates later. The link is read only for a new thread, so a chat is never moved, and
      // only to an event this treasurer can see.
      const owner = ownerOfRequest(res);
      if (
        eventId &&
        !(await getVisibleThread(db, threadId, owner)) &&
        !(await getVisibleEvent(db, eventId, owner))
      ) {
        return fail(res, 400, 'That event does not exist.');
      }
      const thread = await getOrCreateThread(db, threadId, eventId ?? null, owner);
      if (!thread) return fail(res, 404, 'Conversation not found');
      await setTitleIfMissing(db, threadId, message.parts[0]?.text ?? '');
      const history = Array.isArray(thread.messages) ? thread.messages : [];
      let all;
      try {
        all = await validateUIMessages({ messages: [...history, message] });
      } catch {
        return fail(res, 409, 'This conversation is damaged. Start a new chat.');
      }

      const windowed = all.slice(-MODEL_WINDOW);
      const older = all.slice(0, all.length - windowed.length);
      const agent = createOrchestrator({
        db,
        model,
        search: createCatalogSearchClient(),
        eventId: thread.eventId,
        threadId,
        goal: message.parts[0]?.text ?? '',
        // Read from the whole thread, not the model window, so an early choice is not forgotten.
        bookings: bookingChoiceOf(all),
        venuePick: venuePickOf(all),
        bookingPlan: await bookingPlanOf(db, threadId, thread.eventId, all),
      });

      // Stop the run if the browser goes away mid-stream.
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });

      await pipeAgentUIStreamToResponse({
        response: res,
        agent,
        uiMessages: windowed,
        abortSignal: abort.signal,
        timeout: RUN_TIMEOUT_MS,
        onError: (error) => {
          console.error('Agent run failed', error);
          return 'The agent could not finish. Try again.';
        },
        onEnd: async ({ messages }) => {
          await saveMessages(db, threadId, [...older, ...messages]);
        },
      });
    } catch (err) {
      if (sendNotConfigured(res, err)) return;
      console.error('Chat request failed', err);
      if (!res.headersSent) fail(res, 502, 'The agent could not answer. Try again.');
    }
  });

  return router;
}

export const chatRouter = createChatRouter();

// The picked venue's plan and whether it is paid, as facts for the orchestrator so the organizer can ask about it. A failure
// here only means the agent knows less; the chat itself still runs.
async function bookingPlanOf(
  db: Db,
  threadId: string,
  eventId: string | null,
  messages: Parameters<typeof pickedListing>[0],
): Promise<string | null> {
  try {
    const listing = pickedListing(messages);
    const summary = listing && (await bookingSummary(db, listing, eventId));
    if (!listing || !summary) return null;
    return bookingPlanLine(summary, await bookingPayment(db, bookingReference(threadId, listing)));
  } catch (err) {
    console.error('Loading the booking plan failed', err);
    return null;
  }
}
