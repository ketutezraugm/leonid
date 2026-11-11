import { Router, type Request, type RequestHandler, type Response } from 'express';
import { RejectApprovalRequest, type ApprovalItem, type ApprovalsResponse } from '@leonid/shared';
import { currentTreasurer, ownerOf, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { getVisibleEvent, visibleEventIds } from '../db/events.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';
import type { ApprovalView } from '../payments/memory.js';

export interface ApprovalsRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
  db?: () => Db;
}

// Spends the rules sent to the treasurer. Each one has a PayPal order that only the treasurer can approve:
//   GET  /config        public: the PayPal client id the browser SDK needs (a client id is public by design)
//   GET  /              (treasurer) ApprovalsResponse (shared): pending and past approvals, oldest first, with the agent's reasoning
//   POST /:id/capture   (treasurer) after the PayPal popup: PayPal is asked whether the order is approved, then it is captured.
//                       409 for every refusal, including already_paid / in_progress when the webhook got there first.
//   POST /:id/reject    (treasurer) body { reason? } (shared RejectApprovalRequest); the reason goes to the audit log
// A treasurer sees and acts on approvals of the events they can see (canSeeEvent in db/events.ts); any other approval
// is left out of the list and refused like an unknown one.
const toItem = (v: ApprovalView): ApprovalItem => ({
  id: v.id,
  status: v.status,
  createdAt: v.createdAt,
  referenceId: v.spend.referenceId,
  eventId: v.spend.eventId,
  kind: v.spend.kind === 'claim' || v.spend.kind === 'payout' ? 'payout' : 'purchase',
  payee: v.spend.payee,
  payeeEmail: v.spend.payeeEmail,
  amountMinor: v.spend.amountMinor,
  currency: v.spend.currency,
  actor: v.spend.actor,
  agentReason: v.spend.reason,
  reasons: v.reasons,
  category: v.spend.category,
  vendor: v.spend.vendor,
  paypalOrderId: v.paypalOrderId,
});

export function approvalsRouter(options: ApprovalsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const payments = options.payments ?? getPayments;
  const guard = requireTreasurer(env);
  const db = options.db ?? getDb;
  const router = Router();

  // Whether the caller may act on this approval. The ops token is answered without a query.
  const canSeeApproval = async (res: Response, id: string, approvals: PaymentsContext['approvals']) => {
    const owner = ownerOf(currentTreasurer(res));
    if (owner === null) return true;
    const eventId = (await approvals.get(id))?.spend.eventId;
    return Boolean(eventId && (await getVisibleEvent(db(), eventId, owner)));
  };

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
      const owner = ownerOf(currentTreasurer(res));
      const visible = owner === null ? undefined : new Set(await visibleEventIds(db(), owner));
      const rows = (await approvals.list()).filter(
        (v) => !visible || (v.spend.eventId !== undefined && visible.has(v.spend.eventId)),
      );
      const body: ApprovalsResponse = { approvals: rows.map(toItem) };
      res.json(body);
    }),
  );

  router.post(
    '/:id/capture',
    guard,
    withPayments(async (req, res, { approvals, executor }) => {
      if (!(await canSeeApproval(res, String(req.params.id), approvals))) {
        res.status(404).json({ error: 'No such approval' });
        return;
      }
      const outcome = await executor.captureApproved(String(req.params.id), treasurerActor(res));
      if (outcome.status === 'paid' || outcome.status === 'submitted') res.json(outcome);
      else res.status(outcome.status === 'refused' ? 409 : 502).json(outcome);
    }),
  );

  router.post(
    '/:id/reject',
    guard,
    withPayments(async (req, res, { approvals, executor }) => {
      if (!(await canSeeApproval(res, String(req.params.id), approvals))) {
        res.status(404).json({ error: 'No such approval' });
        return;
      }
      const parsed = RejectApprovalRequest.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'reason must be text of at most 200 characters' });
        return;
      }
      const result = await executor.rejectApproval(String(req.params.id), treasurerActor(res), parsed.data.reason);
      res.status(result.rejected ? 200 : 409).json(result);
    }),
  );

  return router;
}
