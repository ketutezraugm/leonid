import { InvoiceDraft } from '@quartermaster/shared';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { requireTreasurer } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { draftForSponsor } from '../invoices/draft.js';
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
// confirms the draft first. Both routes are treasurer-only:
//   GET  /:sponsorId/draft  -> { sponsor, draft }: the pledge as an invoice, for the treasurer to read
//   POST /:sponsorId/send   body { draft, recipientEmail } -> creates and sends the PayPal invoice
export function invoicesRouter(options: InvoicesRouterOptions = {}) {
  const env = options.env ?? process.env;
  const guard = requireTreasurer(env);
  const router = Router();

  const handle =
    (fn: (req: Request, res: Response, deps: { db: Db; client: () => PayPalClient }) => Promise<void>): RequestHandler =>
    async (req, res) => {
      const sponsorId = z.uuid().safeParse(req.params.sponsorId);
      if (!sponsorId.success) {
        res.status(400).json({ error: 'sponsor id must be a UUID' });
        return;
      }
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
          res.status(502).json({ error: 'PayPal rejected the invoice request', debugId: err.debugId });
          return;
        }
        res.status(500).json({ error: 'invoice request failed' });
      }
    };

  router.get(
    '/:sponsorId/draft',
    guard,
    handle(async (req, res, { db }) => {
      const found = await draftForSponsor(db, String(req.params.sponsorId));
      if (!found) {
        res.status(404).json({ error: 'No such sponsor', code: 'sponsor_not_found' });
        return;
      }
      const { sponsor, event, draft } = found;
      res.json({
        sponsor: { id: sponsor.id, name: sponsor.name, tier: sponsor.tier, pledged: sponsor.pledged, status: sponsor.status },
        event: { id: event.id, name: event.name, currency: event.currency },
        draft,
      });
    }),
  );

  router.post(
    '/:sponsorId/send',
    guard,
    handle(async (req, res, { db, client }) => {
      const body = SendBody.safeParse(req.body);
      if (!body.success) {
        res.status(422).json({ error: 'body must be { draft, recipientEmail }', issues: body.error.issues });
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
          actor: 'treasurer',
        },
      );
      res.json(sent);
    }),
  );

  return router;
}
