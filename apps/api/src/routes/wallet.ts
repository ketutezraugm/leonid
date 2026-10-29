import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';
import { PayPalApiError } from '../paypal/errors.js';
import { createPaymentToken, createWalletSetup, deletePaymentToken } from '../paypal/vault.js';

export interface WalletRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
}

// The agent's PayPal wallet: connect it, see its state, and the kill switch.
//   POST /connect  (treasurer) -> { approveUrl }: the treasurer opens it, logs in to PayPal and agrees
//   GET  /return   PayPal sends the browser back here; only setup tokens we created are accepted, once each
//   GET  /         (treasurer) -> { status: none | active | revoked, payerEmail? }
//   POST /revoke   (treasurer) the kill switch: deletes the token at PayPal, so the next charge is refused by PayPal
export function walletRouter(options: WalletRouterOptions = {}) {
  const env = options.env ?? process.env;
  const payments = options.payments ?? getPayments;
  const guard = requireTreasurer(env);
  const router = Router();

  const safe =
    (fn: (req: Request, res: Response, ctx: PaymentsContext, base: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      const base = env.APP_BASE_URL?.replace(/\/$/, '');
      if (!base) {
        res.status(503).json({ error: 'APP_BASE_URL is not configured' });
        return;
      }
      let ctx: PaymentsContext;
      try {
        ctx = payments();
      } catch {
        res.status(503).json({ error: 'PayPal Procurement app is not configured' });
        return;
      }
      try {
        await fn(req, res, ctx, base);
      } catch (err) {
        console.error('wallet route failed', err);
        res.status(err instanceof PayPalApiError ? 502 : 500).json({ error: 'wallet request failed' });
      }
    };

  router.post(
    '/connect',
    guard,
    safe(async (_req, res, { client, wallet }, base) => {
      // One live wallet at a time: connecting over it would leave the old token chargeable with no way to delete it.
      if ((await wallet.snapshot()).status === 'active') {
        res.status(409).json({ error: 'a wallet is already connected; revoke it first' });
        return;
      }
      const setup = await createWalletSetup(client, {
        referenceId: randomUUID(),
        returnUrl: `${base}/api/wallet/return`,
        cancelUrl: `${base}/api/wallet/cancel`,
      });
      await wallet.beginSetup(setup.setupTokenId);
      res.json({ approveUrl: setup.approveUrl });
    }),
  );

  // PayPal's redirect cannot carry our header, so this route is protected by the one-time setup token instead.
  // The redirect target is fixed (APP_BASE_URL), never taken from the request.
  router.get(
    '/return',
    safe(async (req, res, { client, wallet }, base) => {
      const raw = req.query.approval_session_id ?? req.query.approval_token_id;
      const setupTokenId = typeof raw === 'string' ? raw : '';
      if (!setupTokenId || !(await wallet.takeSetup(setupTokenId))) {
        res.redirect(`${base}/?wallet=error`);
        return;
      }
      let saved: Awaited<ReturnType<typeof createPaymentToken>>;
      try {
        saved = await createPaymentToken(client, { setupTokenId });
      } catch (err) {
        console.error('wallet approval could not be completed', err);
        res.redirect(`${base}/?wallet=error`);
        return;
      }
      try {
        await wallet.activate(saved);
      } catch (err) {
        // Another wallet became active in the meantime: the token we just created must not be left chargeable.
        console.error('wallet not activated, deleting the new token', err);
        // Queue it first: if the delete below fails, the kill switch still finds and retries it.
        await wallet.queueDeletion(saved.paymentTokenId);
        try {
          await deletePaymentToken(client, saved.paymentTokenId);
          await wallet.confirmDeleted(saved.paymentTokenId);
        } catch (cleanupErr) {
          if (cleanupErr instanceof PayPalApiError && cleanupErr.status === 404) await wallet.confirmDeleted(saved.paymentTokenId);
          else console.error('cleanup failed; token stays on the pending-deletion list', cleanupErr);
        }
        res.redirect(`${base}/?wallet=error`);
        return;
      }
      res.redirect(`${base}/?wallet=connected`);
    }),
  );

  router.get(
    '/cancel',
    safe(async (_req, res, _ctx, base) => {
      res.redirect(`${base}/?wallet=cancelled`);
    }),
  );

  router.get(
    '/',
    guard,
    safe(async (_req, res, { wallet }) => {
      res.json(await wallet.snapshot());
    }),
  );

  router.post(
    '/revoke',
    guard,
    safe(async (_req, res, { executor }) => {
      res.json(await executor.revokeWallet(treasurerActor(res)));
    }),
  );

  return router;
}
