import { Router, type Request, type RequestHandler, type Response } from 'express';
import { validateUIMessages, type UIMessage } from 'ai';
import { z } from 'zod';
import type {
  VenueDeposit,
  VenueDepositPayResponse,
  VenueDepositResponse,
} from '@quartermaster/shared';
import { venuePickOf } from '../agents/venuePick.js';
import { requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { DbNotConfiguredError, getDb, type Db } from '../db/client.js';
import { getThread } from '../db/mandates.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';
import { findListing, type VenueListing } from '../search/venueCatalog.js';

export interface VenueDepositRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
  db?: () => Db;
}

// The deposit that holds the venue the organizer picked in a chat, paid with PayPal:
//   GET  /:threadId  public: the picked venue's deposit, or null (nothing picked, or not a catalog venue)
//   POST /:threadId  (treasurer) pays it through the executor: rules check -> audit -> PayPal. Within the rules it is
//                    charged to the agent wallet; over them it becomes a PayPal order the treasurer approves.
// Nothing here trusts the browser or the agent: the pick is read from the thread's own messages (and must be a venue the
// scout returned), and the amount from the seeded catalog. One deposit per venue per chat: the reference id is derived
// from both, so a second click replays the first spend instead of paying twice.
export function venueDepositRouter(options: VenueDepositRouterOptions = {}) {
  const env = options.env ?? process.env;
  const payments = options.payments ?? getPayments;
  const db = options.db ?? getDb;
  const router = Router();

  async function pickedVenue(
    threadId: string,
  ): Promise<{ listing: VenueListing; eventId: string | null } | null> {
    const thread = await getThread(db(), threadId);
    if (!thread || !Array.isArray(thread.messages) || thread.messages.length === 0) return null;
    let messages: UIMessage[];
    try {
      messages = await validateUIMessages({ messages: thread.messages });
    } catch {
      return null;
    }
    const pick = venuePickOf(messages);
    const listing = pick && findListing(pick.sourceUrl);
    return listing && listing.name === pick.name ? { listing, eventId: thread.eventId } : null;
  }

  const depositOf = (listing: VenueListing): VenueDeposit => ({
    venue: listing.name,
    area: `${listing.area}, ${listing.city}`,
    amountMinor: listing.deposit.amountMinor,
    currency: listing.deposit.currency,
  });

  const handle =
    (fn: (req: Request, res: Response, threadId: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      const threadId = z.uuid().safeParse(req.params.threadId);
      if (!threadId.success) {
        res.status(400).json({ error: 'Invalid thread id' });
        return;
      }
      try {
        await fn(req, res, threadId.data);
      } catch (err) {
        if (err instanceof DbNotConfiguredError) {
          res.status(503).json({ error: 'The database is not configured on this server.' });
          return;
        }
        console.error('venue deposit route failed', err);
        res.status(500).json({ error: 'venue deposit request failed' });
      }
    };

  router.get(
    '/:threadId',
    handle(async (_req, res, threadId) => {
      const picked = await pickedVenue(threadId);
      const body: VenueDepositResponse = { deposit: picked ? depositOf(picked.listing) : null };
      res.json(body);
    }),
  );

  router.post(
    '/:threadId',
    requireTreasurer(env),
    handle(async (_req, res, threadId) => {
      let ctx: PaymentsContext;
      try {
        ctx = payments();
      } catch {
        res.status(503).json({ error: 'PayPal Procurement app is not configured' });
        return;
      }
      const picked = await pickedVenue(threadId);
      if (!picked) {
        res.status(409).json({ error: 'Pick one of the seeded venues in this chat first.' });
        return;
      }
      const { listing, eventId } = picked;
      const deposit = depositOf(listing);
      const outcome = await ctx.executor.requestSpend({
        referenceId: `venue-deposit-${threadId}-${listing.id}`,
        amountMinor: deposit.amountMinor,
        currency: deposit.currency,
        actor: treasurerActor(res),
        reason: `Deposit to hold ${listing.name} (${deposit.area}), picked in the agent chat`,
        category: 'venue',
        vendor: listing.name,
        eventId: eventId ?? undefined,
      });
      const body: VenueDepositPayResponse = { deposit, outcome };
      const status =
        outcome.status === 'failed'
          ? 502
          : outcome.status === 'paid' || outcome.status === 'needs_approval'
            ? 200
            : 409;
      res.status(status).json(body);
    }),
  );

  return router;
}
