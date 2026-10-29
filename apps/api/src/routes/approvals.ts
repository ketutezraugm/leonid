import { Router, type Request, type RequestHandler, type Response } from 'express';
import { requireTreasurer } from '../auth/treasurer.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';

export interface ApprovalsRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
}

// Spends the rules sent to the treasurer. Each one has a PayPal order that only the treasurer can approve:
//   GET  /config        public: the PayPal client id the browser SDK needs (a client id is public by design)
//   GET  /              (treasurer) pending and past approvals with the agent's reasoning
//   POST /:id/capture   (treasurer) after the PayPal popup: PayPal is asked whether the order is approved, then it is captured.
//                       409 for every refusal, including already_paid / in_progress when the webhook got there first.
//   POST /:id/reject    (treasurer)
export function approvalsRouter(options: ApprovalsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const payments = options.payments ?? getPayments;
  const guard = requireTreasurer(env);
  const router = Router();

  const withPayments =
    (fn: (req: Request, res: Response, ctx: PaymentsContext) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let ctx: PaymentsContext;
      try {
        ctx = payments();
      } catch {
        res.status(503).json({ error: 'PayPal Procurement app is not configured' });
        return;
      }
      try {
        await fn(req, res, ctx);
      } catch (err) {
        console.error('approvals route failed', err);
        res.status(500).json({ error: 'approval request failed' });
      }
    };

  router.get('/config', (_req, res) => {
    const clientId = env.PAYPAL_PROCUREMENT_CLIENT_ID;
    if (!clientId) {
      res.status(503).json({ error: 'PayPal Procurement app is not configured' });
      return;
    }
    res.json({ clientId, environment: 'sandbox' });
  });

  router.get(
    '/',
    guard,
    withPayments(async (_req, res, { approvals }) => {
      res.json({ approvals: await approvals.list() });
    }),
  );

  router.post(
    '/:id/capture',
    guard,
    withPayments(async (req, res, { executor }) => {
      const outcome = await executor.captureApproved(String(req.params.id), 'treasurer');
      if (outcome.status === 'paid') res.json(outcome);
      else res.status(outcome.status === 'refused' ? 409 : 502).json(outcome);
    }),
  );

  router.post(
    '/:id/reject',
    guard,
    withPayments(async (req, res, { executor }) => {
      const result = await executor.rejectApproval(String(req.params.id), 'treasurer');
      res.status(result.rejected ? 200 : 409).json(result);
    }),
  );

  return router;
}
