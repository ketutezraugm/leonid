import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { currentTreasurer, refuseDemoSession, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { writeAudit } from '../db/audit.js';
import { getDb, type Db } from '../db/client.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';
import { addPoolSetup, endDemoPool, exchangePoolSetup, MAX_POOL, poolCounts, promoteNextStandby } from '../payments/pool.js';
import { PayPalApiError } from '../paypal/errors.js';
import { createWalletSetup } from '../paypal/vault.js';

export interface WalletPoolRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
  db?: () => Db;
}

const FillBody = z.object({ count: z.number().int().min(1).max(MAX_POOL).default(3) });

// The hosted demo's wallet pool (all routes treasurer-only except /return). The shared demo needs "Reset demo" without a human
// logging in to PayPal each time, so a few wallet tokens are approved ahead of time and kept on standby. Standby tokens are never
// charged: only Reset turns one into the agent's wallet, after the kill switch has deleted the current one at PayPal.
//   GET  /        -> { waiting, standby, max }: approval links not yet approved, tokens ready
//   POST /fill    { count?: 1-5, default 3 } -> { links }: open each in a NORMAL browser window as the sandbox Personal account and approve
//   GET  /return  PayPal sends the browser back here; only setup tokens made by /fill are accepted, once each
//   POST /reset   kill switch on the current wallet, then the oldest standby token becomes the wallet. Refuses (nothing revoked) when the pool is empty
//   POST /end     deletes every standby token at PayPal (call it when the demo is over); the current wallet is left alone, use /api/wallet/revoke for that
export function walletPoolRouter(options: WalletPoolRouterOptions = {}) {
  const env = options.env ?? process.env;
  const payments = options.payments ?? getPayments;
  const guard = requireTreasurer(env);
  const router = Router();

  const safe =
    (fn: (req: Request, res: Response, ctx: PaymentsContext, db: Db, base: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      const base = env.APP_BASE_URL?.replace(/\/$/, '');
      if (!base) {
        res.status(503).json({ error: 'APP_BASE_URL is not configured' });
        return;
      }
      let ctx: PaymentsContext;
      let db: Db;
      try {
        ctx = payments();
        db = (options.db ?? getDb)();
      } catch {
        res.status(503).json({ error: 'the PayPal Procurement app or the database is not configured' });
        return;
      }
      try {
        await fn(req, res, ctx, db, base);
      } catch (err) {
        console.error('wallet pool route failed', err instanceof Error ? err.message : err);
        res.status(err instanceof PayPalApiError ? 502 : 500).json({ error: 'wallet pool request failed' });
      }
    };

  router.get(
    '/',
    guard,
    safe(async (_req, res, _ctx, db) => {
      res.json({ ...(await poolCounts(db)), max: MAX_POOL });
    }),
  );

  router.post(
    '/fill',
    guard,
    refuseDemoSession,
    safe(async (req, res, { client }, db, base) => {
      const body = FillBody.safeParse(req.body ?? {});
      if (!body.success) {
        res.status(422).json({ error: `count must be a whole number from 1 to ${MAX_POOL}` });
        return;
      }
      const { waiting, standby } = await poolCounts(db);
      if (waiting + standby + body.data.count > MAX_POOL) {
        res.status(409).json({ error: `the pool holds at most ${MAX_POOL} (now ${standby} ready, ${waiting} waiting for approval)` });
        return;
      }
      const links: string[] = [];
      for (let i = 0; i < body.data.count; i += 1) {
        const setup = await createWalletSetup(client, {
          referenceId: randomUUID(),
          returnUrl: `${base}/api/wallet/pool/return`,
          cancelUrl: `${base}/api/wallet/cancel`,
          permitMultipleTokens: true,
        });
        await addPoolSetup(db, setup.setupTokenId);
        links.push(setup.approveUrl);
      }
      res.json({ links });
    }),
  );

  // PayPal's redirect cannot carry our header, so this route is protected by the one-time setup token instead.
  // The redirect target is fixed (APP_BASE_URL), never taken from the request.
  router.get(
    '/return',
    safe(async (req, res, { client }, db, base) => {
      const raw = req.query.approval_session_id ?? req.query.approval_token_id;
      const setupTokenId = typeof raw === 'string' ? raw : '';
      let added = false;
      if (setupTokenId) {
        try {
          added = await exchangePoolSetup(db, client, setupTokenId);
        } catch (err) {
          console.error('pool approval could not be completed', err instanceof Error ? err.message : err);
        }
      }
      res.redirect(`${base}/?pool=${added ? 'added' : 'error'}`);
    }),
  );

  router.post(
    '/reset',
    guard,
    safe(async (_req, res, { executor, wallet }, db) => {
      const actor = treasurerActor(res);
      // A judge's demo session restores a wallet that was revoked. Resetting a live one would only use up the spare
      // tokens, so a demo session is refused while the wallet is active; a real login and the ops token are not.
      if (currentTreasurer(res).via === 'demo' && (await wallet.getActive())) {
        res.status(409).json({ error: 'The demo wallet is already active' });
        return;
      }
      if ((await poolCounts(db)).standby === 0) {
        res.status(409).json({ error: 'no standby wallet in the pool; the current wallet was not touched' });
        return;
      }
      // The kill switch first: the current token is deleted at PayPal before another one can take its place.
      await executor.revokeWallet(actor);
      const next = await promoteNextStandby(db);
      if (!next) {
        res.status(409).json({ error: 'the standby wallet was taken in the meantime; the current wallet is revoked' });
        return;
      }
      await writeAudit(db, {
        actor,
        action: 'wallet.pool_reset',
        input: { standbyLeft: (await poolCounts(db)).standby },
        reason: 'demo reset: the kill switch deleted the old wallet and the next standby wallet is active',
        paypalId: next.paymentTokenId,
      });
      res.json({ status: 'active', payerEmail: next.payerEmail ?? undefined, ...(await poolCounts(db)) });
    }),
  );

  router.post(
    '/end',
    guard,
    refuseDemoSession,
    safe(async (_req, res, { client }, db) => {
      const result = await endDemoPool(db, client);
      await writeAudit(db, {
        actor: treasurerActor(res),
        action: 'wallet.pool_end',
        input: result,
        reason: 'end of the demo: standby wallet tokens deleted at PayPal',
      });
      res.status(result.failed > 0 ? 502 : 200).json(result);
    }),
  );

  return router;
}
