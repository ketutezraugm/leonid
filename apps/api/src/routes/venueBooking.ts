import { Router, type Request, type RequestHandler, type Response } from 'express';
import { validateUIMessages, type UIMessage } from 'ai';
import { z } from 'zod';
import {
  venueEstimate,
  type VenueBookingPayResponse,
  type VenueBookingResponse,
  type VenueBookingSummary,
} from '@quartermaster/shared';
import { venuePickOf } from '../agents/venuePick.js';
import { currentTreasurer, ownerOf, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { DbNotConfiguredError, getDb, type Db } from '../db/client.js';
import { getEvent } from '../db/events.js';
import { getVisibleThread } from '../db/mandates.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';
import { LOCAL_MINOR_PER_USD, isFxCurrency, toUsdCents } from '../pricing/fx.js';
import { findListing, listingUrl, type VenueListing } from '../search/venueCatalog.js';

export interface VenueBookingRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
  db?: () => Db;
}

// The venue the organizer picked in a chat, as a plan summary to review and then pay in full with PayPal:
//   GET  /:threadId  (treasurer) the summary (event, venue, one-day estimate, USD total), or null (nothing picked, not a
//                    catalog venue, no event on the chat, or not the caller's chat)
//   POST /:threadId  (treasurer) pays the USD total through the executor: rules check -> audit -> PayPal. Within the rules it
//                    is charged to the agent wallet; over them it becomes a PayPal order the treasurer approves.
// Nothing here trusts the browser or the agent: the pick is read from the thread's own messages (and must be a venue the
// scout returned), the price from the seeded catalog, the headcount from the event row and the exchange rate from a fixed
// demo table. One booking per venue per chat: the reference id is derived from both, so a second click replays the first
// spend instead of paying twice.
export function venueBookingRouter(options: VenueBookingRouterOptions = {}) {
  const env = options.env ?? process.env;
  const payments = options.payments ?? getPayments;
  const db = options.db ?? getDb;
  const router = Router();

  async function pickedVenue(
    threadId: string,
    owner: string | null,
  ): Promise<{ listing: VenueListing; eventId: string | null } | null> {
    const thread = await getVisibleThread(db(), threadId, owner);
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

  async function summaryOf(
    listing: VenueListing,
    eventId: string | null,
  ): Promise<VenueBookingSummary | null> {
    const event = eventId ? await getEvent(db(), eventId) : undefined;
    if (!event || !isFxCurrency(listing.price.currency)) return null;
    const estimate = venueEstimate(listing, event.headcount);
    if (!estimate) return null;
    const payableMinor = toUsdCents(estimate.total, listing.price.currency);
    const maxSpend =
      event.maxSpendMinor === null
        ? null
        : { amountMinor: event.maxSpendMinor, currency: event.currency };
    return {
      event: {
        name: event.name,
        date: event.date.toISOString(),
        headcount: event.headcount,
        maxSpend,
      },
      venue: {
        name: listing.name,
        area: `${listing.area}, ${listing.city}`,
        includes: listing.terms.includes,
        catering: listing.catering,
        sourceUrl: listingUrl(listing),
      },
      estimate: { ...estimate, currency: listing.price.currency },
      fx: {
        from: listing.price.currency,
        localMinorPerUsd: LOCAL_MINOR_PER_USD[listing.price.currency],
      },
      payable: { amountMinor: payableMinor, currency: 'USD' },
      // check() compares in one currency only, so the early warning does too.
      overMaxSpend:
        maxSpend !== null && maxSpend.currency === 'USD' && payableMinor > maxSpend.amountMinor,
    };
  }

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
        console.error('venue booking route failed', err);
        res.status(500).json({ error: 'venue booking request failed' });
      }
    };

  router.get(
    '/:threadId',
    requireTreasurer(env),
    handle(async (_req, res, threadId) => {
      const picked = await pickedVenue(threadId, ownerOf(currentTreasurer(res)));
      const body: VenueBookingResponse = {
        summary: picked ? await summaryOf(picked.listing, picked.eventId) : null,
      };
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
      const picked = await pickedVenue(threadId, ownerOf(currentTreasurer(res)));
      const summary = picked && (await summaryOf(picked.listing, picked.eventId));
      if (!picked || !summary) {
        res.status(409).json({
          error: 'Pick one of the seeded venues in a chat linked to an event first.',
        });
        return;
      }
      const { listing, eventId } = picked;
      const local = formatLocal(summary.estimate.total, summary.estimate.currency);
      const outcome = await ctx.executor.requestSpend({
        referenceId: `venue-booking-${threadId}-${listing.id}`,
        amountMinor: summary.payable.amountMinor,
        currency: summary.payable.currency,
        actor: treasurerActor(res),
        reason: `Venue hire for ${summary.event.name} at ${listing.name} (${summary.venue.area}): ${local} at the demo exchange rate, agreed by the organizer`,
        category: 'venue',
        vendor: listing.name,
        eventId: eventId ?? undefined,
      });
      const body: VenueBookingPayResponse = { summary, outcome };
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

// "IDR 19,300,000" for an audit reason; the venue currencies' minor units differ, so IDR has none.
function formatLocal(amountMinor: number, currency: string): string {
  const major = currency === 'IDR' ? amountMinor : amountMinor / 100;
  return `${currency} ${major.toLocaleString('en-US')}`;
}
