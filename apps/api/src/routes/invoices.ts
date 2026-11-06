import { InvoiceDraft, SponsorsResponse } from '@quartermaster/shared';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { currentTreasurer, ownerOf, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { canSeeEvent, getDemoEvent, getVisibleEvent, listSponsors } from '../db/events.js';
import { draftForSponsor, loadSponsorWithEvent } from '../invoices/draft.js';
import { InvoiceRefusedError, sendSponsorInvoice, type InvoiceRefusal } from '../invoices/send.js';
import { getPayPalClient, type PayPalClient } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';

export interface InvoicesRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  client?: () => PayPalClient;
  now?: () => Date;
}

const SendBody = z.object({ draft: InvoiceDraft, recipientEmail: z.email() });

// Every event-scoped endpoint takes ?eventId=. Here it is optional, because a sponsor belongs to exactly one event:
// when it is given, the sponsor must be in that event, so a stale screen cannot invoice another event's sponsor.
const EventQuery = z.object({ eventId: z.uuid().optional() });

const REFUSAL_STATUS: Record<InvoiceRefusal, number> = {
  sponsor_not_found: 404,
  draft_mismatch: 422,
  already_paid: 409,
  already_invoiced: 409,
  stale_invoice: 409,
  invoice_mismatch: 409,
  duplicate_invoice: 409,
  in_progress: 409,
};

// Sponsor invoices (F4). Drafting is read-only; sending asks the sponsor for money, so a treasurer
// confirms the draft first. All routes are treasurer-only:
//   GET  /[?eventId=…]                  -> { sponsors }: the event's sponsors with their status, for the Money tab.
//                                          With no eventId it is the seeded demo event (a read).
//   GET  /:sponsorId/draft[?eventId=…]  -> { sponsor, draft }: the pledge as an invoice, for the treasurer to read
//   POST /:sponsorId/send[?eventId=…]   body { draft, recipientEmail } -> creates and sends the PayPal invoice
// A named eventId that is not the sponsor's event answers like an unknown sponsor (404), and so does a sponsor or event
// the caller cannot see (canSeeEvent in db/events.ts).
export function invoicesRouter(options: InvoicesRouterOptions = {}) {
  const env = options.env ?? process.env;
  const guard = requireTreasurer(env);
  const router = Router();

  const validSponsorId: RequestHandler = (req, res, next) => {
    if (!z.uuid().safeParse(req.params.sponsorId).success) {
      res.status(400).json({ error: 'sponsor id must be a UUID' });
      return;
    }
    next();
  };

  const validEventQuery: RequestHandler = (req, res, next) => {
    const query = EventQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'eventId must be a UUID' });
      return;
    }
    res.locals.eventId = query.data.eventId;
    next();
  };

  const notFound = (res: Response) =>
    res.status(404).json({ error: 'No such sponsor', code: 'sponsor_not_found' });

  const handle =
    (
      fn: (
        req: Request,
        res: Response,
        deps: { db: Db; client: () => PayPalClient },
      ) => Promise<void>,
    ): RequestHandler =>
    async (req, res) => {
      let db: Db;
      try {
        db = (options.db ?? getDb)();
      } catch {
        res.status(503).json({ error: 'database is not configured' });
        return;
      }
      try {
        await fn(req, res, { db, client: options.client ?? (() => getPayPalClient('treasury')) });
      } catch (err) {
        if (err instanceof InvoiceRefusedError) {
          res.status(REFUSAL_STATUS[err.code]).json({ error: err.message, code: err.code });
          return;
        }
        console.error('invoice route failed', err);
        if (err instanceof PayPalApiError) {
          res
            .status(502)
            .json({ error: 'PayPal rejected the invoice request', debugId: err.debugId });
          return;
        }
        res.status(500).json({ error: 'invoice request failed' });
      }
    };

  router.get(
    '/',
    guard,
    validEventQuery,
    handle(async (_req, res, { db }) => {
      const event = res.locals.eventId
        ? await getVisibleEvent(db, res.locals.eventId, ownerOf(currentTreasurer(res)))
        : await getDemoEvent(db);
      if (!event) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      const rows = await listSponsors(db, event.id);
      res.json(
        SponsorsResponse.parse({
          sponsors: rows.map((s) => ({
            id: s.id,
            eventId: s.eventId,
            name: s.name,
            tier: s.tier,
            pledged: s.pledged,
            currency: event.currency,
            status: s.status,
            paypalInvoiceId: s.paypalInvoiceId,
          })),
        }),
      );
    }),
  );

  router.get(
    '/:sponsorId/draft',
    guard,
    validSponsorId,
    validEventQuery,
    handle(async (req, res, { db }) => {
      const found = await draftForSponsor(db, String(req.params.sponsorId));
      if (
        !found ||
        !canSeeEvent(found.event, ownerOf(currentTreasurer(res))) ||
        (res.locals.eventId && found.event.id !== res.locals.eventId)
      ) {
        notFound(res);
        return;
      }
      const { sponsor, event, draft } = found;
      res.json({
        sponsor: {
          id: sponsor.id,
          name: sponsor.name,
          tier: sponsor.tier,
          pledged: sponsor.pledged,
          status: sponsor.status,
        },
        event: { id: event.id, name: event.name, currency: event.currency },
        draft,
      });
    }),
  );

  router.post(
    '/:sponsorId/send',
    guard,
    validSponsorId,
    validEventQuery,
    handle(async (req, res, { db, client }) => {
      const body = SendBody.safeParse(req.body);
      if (!body.success) {
        res
          .status(422)
          .json({ error: 'body must be { draft, recipientEmail }', issues: body.error.issues });
        return;
      }
      const found = await loadSponsorWithEvent(db, String(req.params.sponsorId));
      if (
        !found ||
        !canSeeEvent(found.event, ownerOf(currentTreasurer(res))) ||
        (res.locals.eventId && found.event.id !== res.locals.eventId)
      ) {
        notFound(res);
        return;
      }
      let paypal: PayPalClient;
      try {
        paypal = client();
      } catch {
        res.status(503).json({ error: 'PayPal Treasury app is not configured' });
        return;
      }
      const sent = await sendSponsorInvoice(
        { db, client: paypal, now: options.now },
        {
          sponsorId: String(req.params.sponsorId),
          draft: body.data.draft,
          recipientEmail: body.data.recipientEmail,
          actor: treasurerActor(res),
        },
      );
      res.json(sent);
    }),
  );

  return router;
}
