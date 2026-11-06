import {
  ClaimsResponse,
  ClaimView,
  CreateVolunteerRequest,
  CreateVolunteerResponse,
  RECEIPT_MAX_BYTES,
  ReviewClaimRequest,
  SubmitClaimRequest,
  VolunteerClaimsResponse,
} from '@quartermaster/shared';
import type { LanguageModel } from 'ai';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { chatModel } from '../agents/model.js';
import { requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import {
  claimView,
  createVolunteer,
  findVolunteerByToken,
  getReceipt,
  listEventClaims,
  listVolunteerClaims,
  reviewClaim,
  submitClaim,
  type ClaimDeps,
} from '../claims/service.js';
import { getDb, type Db } from '../db/client.js';
import { getDemoEvent, getEvent } from '../db/events.js';
import { getPayments } from '../payments/context.js';
import { createDbApprovals } from '../payments/db.js';
import type { Executor } from '../payments/executor.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';

export interface ClaimsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  // The receipt reader. Undefined (or throwing): every claim waits for the treasurer to read it.
  model?: () => LanguageModel | undefined;
  // The executor. Throwing: this server cannot pay, so claims wait for a human.
  payments?: () => Pick<Executor, 'requestSpend'>;
  submitLimiter?: RateLimiter;
}

// The receipt types we accept, by their first bytes: the declared type has to match what was sent.
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

const EventQuery = z.object({ eventId: z.uuid().optional() });

// F16 receipt claims.
//   POST /volunteers         treasurer: register a volunteer and get their claim link's token (shown once)
//   GET  /?eventId=          treasurer: the event's claims and volunteers
//   GET  /:id/receipt        treasurer: the receipt photo
//   POST /:id/review         treasurer: confirm the amount of a claim waiting on review
//   GET  /mine               volunteer (x-claim-token): my claims
//   POST /mine               volunteer (x-claim-token): a new claim with a receipt photo
// Mounted before the app's JSON parser: a receipt photo is larger than its 100 kB limit.
export function claimsRouter(options: ClaimsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const guard = requireTreasurer(env);
  const submitLimiter = options.submitLimiter ?? createRateLimiter({ max: 10, windowMs: 10 * 60_000 });
  const router = Router();
  const smallJson = express.json();
  const photoJson = express.json({ limit: `${Math.ceil((RECEIPT_MAX_BYTES * 4) / 3 / 1024) + 64}kb` });

  const depsFor = (db: Db): ClaimDeps => {
    let model: LanguageModel | undefined;
    try {
      model = (options.model ?? chatModel)();
    } catch {
      model = undefined; // no model configured: claims wait for a human
    }
    let requestSpend: ClaimDeps['requestSpend'];
    try {
      requestSpend = (options.payments ?? (() => getPayments().executor))().requestSpend;
    } catch {
      requestSpend = undefined; // PayPal not configured: claims wait for a human
    }
    const approvals = createDbApprovals(db);
    return { db, model, requestSpend, approvalStatus: async (ref) => (await approvals.findByReference(ref))?.status };
  };

  const handle =
    (fn: (req: Request, res: Response, db: Db) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let db: Db;
      try {
        db = (options.db ?? getDb)();
      } catch {
        res.status(503).json({ error: 'database is not configured' });
        return;
      }
      try {
        await fn(req, res, db);
      } catch (err) {
        console.error('claims request failed', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'claims request failed' });
      }
    };

  const eventIdOf = async (db: Db, eventId: string | undefined) =>
    eventId ? (await getEvent(db, eventId))?.id : (await getDemoEvent(db))?.id;

  // The volunteer, by their claim token. Sent as a header, so it stays out of request logs.
  const volunteerOf = (req: Request, db: Db) => findVolunteerByToken(db, String(req.get('x-claim-token') ?? ''));

  router.get(
    '/mine',
    handle(async (req, res, db) => {
      const volunteer = await volunteerOf(req, db);
      if (!volunteer) {
        res.status(401).json({ error: 'This claim link is not valid' });
        return;
      }
      const event = await getEvent(db, volunteer.eventId);
      const claims = await listVolunteerClaims(depsFor(db), volunteer);
      res.json(VolunteerClaimsResponse.parse({ volunteer: { name: volunteer.name, eventName: event?.name ?? '' }, claims }));
    }),
  );

  router.post(
    '/mine',
    photoJson,
    handle(async (req, res, db) => {
      if (!submitLimiter.take(req)) {
        res.status(429).json({ error: 'Too many claims from here; try again in a few minutes' });
        return;
      }
      const volunteer = await volunteerOf(req, db);
      if (!volunteer) {
        res.status(401).json({ error: 'This claim link is not valid' });
        return;
      }
      const body = SubmitClaimRequest.safeParse(req.body);
      if (!body.success) {
        res.status(422).json({ error: 'invalid claim', issues: body.error.issues });
        return;
      }
      const image = Buffer.from(body.data.imageBase64, 'base64');
      if (image.length === 0 || image.length > RECEIPT_MAX_BYTES || !MAGIC[body.data.mimeType]!(image)) {
        res.status(422).json({ error: 'The photo must be a JPEG, PNG or WebP image of at most 5 MB' });
        return;
      }
      const claim = await submitClaim(depsFor(db), volunteer, { category: body.data.category, image, mimeType: body.data.mimeType });
      if (!claim) {
        res.status(404).json({ error: 'This event is no longer running' });
        return;
      }
      res.status(201).json(ClaimView.parse(claimView(claim, volunteer.name)));
    }),
  );

  router.post(
    '/volunteers',
    guard,
    smallJson,
    handle(async (req, res, db) => {
      const body = CreateVolunteerRequest.safeParse(req.body);
      if (!body.success) {
        res.status(422).json({ error: 'invalid volunteer', issues: body.error.issues });
        return;
      }
      const eventId = await eventIdOf(db, body.data.eventId);
      if (!eventId) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      const made = await createVolunteer(db, { eventId, name: body.data.name, payoutEmail: body.data.payoutEmail });
      res.status(201).json(CreateVolunteerResponse.parse(made));
    }),
  );

  router.get(
    '/',
    guard,
    handle(async (req, res, db) => {
      const query = EventQuery.safeParse(req.query);
      if (!query.success) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      const eventId = await eventIdOf(db, query.data.eventId);
      if (!eventId) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(ClaimsResponse.parse(await listEventClaims(depsFor(db), eventId)));
    }),
  );

  router.get(
    '/:id/receipt',
    guard,
    handle(async (req, res, db) => {
      const id = z.uuid().safeParse(req.params.id);
      const receipt = id.success ? await getReceipt(db, id.data) : undefined;
      if (!receipt) {
        res.status(404).json({ error: 'No such claim' });
        return;
      }
      res.set({ 'content-type': receipt.mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300' });
      res.send(receipt.image);
    }),
  );

  router.post(
    '/:id/review',
    guard,
    smallJson,
    handle(async (req, res, db) => {
      const id = z.uuid().safeParse(req.params.id);
      const body = ReviewClaimRequest.safeParse(req.body);
      if (!id.success || !body.success) {
        res.status(422).json({ error: 'invalid review' });
        return;
      }
      const result = await reviewClaim(depsFor(db), id.data, body.data.amount, treasurerActor(res));
      if ('error' in result) {
        const missing = result.error === 'not_found';
        res
          .status(missing ? 404 : 409)
          .json({ error: missing ? 'No such claim' : 'This claim is not waiting on review', code: result.error });
        return;
      }
      res.json(ClaimView.parse(result.claim));
    }),
  );

  return router;
}
