import { Router, type Request, type RequestHandler, type Response } from 'express';
import { validateUIMessages, type UIMessage } from 'ai';
import { z } from 'zod';
import type {
  VenueBookingHistoryResponse,
  VenueBookingPayResponse,
  VenueBookingResponse,
} from '@leonid/shared';
import { currentTreasurer, ownerOf, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { DbNotConfiguredError, getDb, type Db } from '../db/client.js';
import { getVisibleThread, listOwnerEventThreads } from '../db/mandates.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';
import { invoiceNumber, venueInvoicePdf } from '../booking/invoice.js';
import {
  bookingPaidAt,
  bookingPayment,
  bookingReference,
  bookingSummary,
  pickedListing,
} from '../booking/venueBooking.js';
import type { VenueListing } from '../search/venueCatalog.js';

export interface VenueBookingRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
  db?: () => Db;
}

// The venue the organizer picked in a chat, as a plan summary to review and then pay in full with PayPal:
//   GET  /           (treasurer) every plan in the caller's chats with its payment status: the plan history
//   GET  /:threadId  (treasurer) the summary (event, venue, one-day estimate, USD total), or null (nothing picked, not a
//                    catalog venue, no event on the chat, or not the caller's chat)
//   GET  /:threadId/invoice (treasurer) the paid plan as a PDF invoice; 404 without a plan, 409 until it is paid
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

  async function picked(
    threadId: string,
    owner: string | null,
  ): Promise<{ listing: VenueListing; eventId: string | null } | null> {
    const thread = await getVisibleThread(db(), threadId, owner);
    return thread ? pickOf(thread) : null;
  }

  async function pickOf(thread: {
    messages: unknown;
    eventId: string | null;
  }): Promise<{ listing: VenueListing; eventId: string | null } | null> {
    if (!Array.isArray(thread.messages) || thread.messages.length === 0) return null;
    let messages: UIMessage[];
    try {
      messages = await validateUIMessages({ messages: thread.messages });
    } catch {
      return null;
    }
    const listing = pickedListing(messages);
    return listing ? { listing, eventId: thread.eventId } : null;
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
    '/',
    requireTreasurer(env),
    async (_req, res) => {
      try {
        const threads = await listOwnerEventThreads(db(), ownerOf(currentTreasurer(res)));
        const plans: VenueBookingHistoryResponse['plans'] = [];
        for (const thread of threads) {
          const pick = await pickOf(thread);
          const summary = pick && (await bookingSummary(db(), pick.listing, pick.eventId));
          if (!pick || !summary || !pick.eventId) continue;
          plans.push({
            threadId: thread.id,
            eventId: pick.eventId,
            updatedAt: thread.updatedAt.toISOString(),
            summary,
            payment: await bookingPayment(db(), bookingReference(thread.id, pick.listing)),
          });
        }
        const body: VenueBookingHistoryResponse = { plans };
        res.json(body);
      } catch (err) {
        if (err instanceof DbNotConfiguredError) {
          res.status(503).json({ error: 'The database is not configured on this server.' });
          return;
        }
        console.error('venue booking history failed', err);
        res.status(500).json({ error: 'venue booking request failed' });
      }
    },
  );

  router.get(
    '/:threadId',
    requireTreasurer(env),
    handle(async (_req, res, threadId) => {
      const pick = await picked(threadId, ownerOf(currentTreasurer(res)));
      const summary = pick && (await bookingSummary(db(), pick.listing, pick.eventId));
      const body: VenueBookingResponse = {
        summary: summary ?? null,
        payment:
          pick && summary
            ? await bookingPayment(db(), bookingReference(threadId, pick.listing))
            : { status: 'unpaid' },
      };
      res.json(body);
    }),
  );

  router.get(
    '/:threadId/invoice',
    requireTreasurer(env),
    handle(async (_req, res, threadId) => {
      const pick = await picked(threadId, ownerOf(currentTreasurer(res)));
      const summary = pick && (await bookingSummary(db(), pick.listing, pick.eventId));
      if (!pick || !summary) {
        res.status(404).json({ error: 'No plan to invoice.' });
        return;
      }
      const referenceId = bookingReference(threadId, pick.listing);
      const payment = await bookingPayment(db(), referenceId);
      if (payment.status !== 'paid') {
        res.status(409).json({ error: 'Only a paid plan has an invoice.' });
        return;
      }
      const pdf = await venueInvoicePdf({
        threadId,
        summary,
        reference: payment.reference,
        paidAt: (await bookingPaidAt(db(), referenceId)) ?? new Date(),
      });
      res
        .status(200)
        .type('application/pdf')
        .set('Content-Disposition', `attachment; filename="invoice-${invoiceNumber(threadId)}.pdf"`)
        .send(Buffer.from(pdf));
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
      const pick = await picked(threadId, ownerOf(currentTreasurer(res)));
      const summary = pick && (await bookingSummary(db(), pick.listing, pick.eventId));
      if (!pick || !summary) {
        res.status(409).json({
          error: 'Pick one of the seeded venues in a chat linked to an event first.',
        });
        return;
      }
      const { listing, eventId } = pick;
      const local = formatLocal(summary.estimate.total, summary.estimate.currency);
      const outcome = await ctx.executor.requestSpend({
        referenceId: bookingReference(threadId, listing),
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
