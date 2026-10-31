import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { getPayments, type PaymentsContext } from '../payments/context.js';
import type { SpendOutcome } from '../payments/executor.js';

export interface DemoRouterOptions {
  env?: NodeJS.ProcessEnv;
  payments?: () => PaymentsContext;
}

// Largest demo spend, in cents. Sandbox money only, but it keeps a stray click from draining the test balance.
export const DEMO_SPEND_MAX_MINOR = 100_000;

const Body = z.object({
  amountMinor: z.number().int().min(1).max(DEMO_SPEND_MAX_MINOR),
  label: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(50).optional(),
  vendor: z.string().trim().min(1).max(100).optional(),
  // Send the same id to retry a spend safely: PayPal's idempotency key comes from it, so it can only be charged once.
  referenceId: z.string().trim().min(1).max(64).optional(),
  eventId: z.uuid().optional(),
});

const STATUS: Record<SpendOutcome['status'], number> = { paid: 200, needs_approval: 202, blocked: 403, refused: 409, failed: 502 };

// A stand-in for the procurement agent's spend tool (Harfi), so the Gate 2 beats can be shown before it lands:
//   POST /spend  (treasurer, only when DEMO_SPEND=true)  { amountMinor, label, category?, vendor?, referenceId?, eventId? }
// It adds no money path of its own: the spend goes through executor.requestSpend like any agent's would, so the rules
// check, the audit row, the kill switch and the approval flow all apply. $140 auto-pays, $420 opens an approval.
// Delete this file once an agent tool calls requestSpend.
export function demoRouter(options: DemoRouterOptions = {}) {
  const env = options.env ?? process.env;
  const payments = options.payments ?? getPayments;
  const router = Router();
  const enabled = env.DEMO_SPEND === 'true';
  if (enabled && env.NODE_ENV === 'production') {
    console.warn('!!! DEMO_SPEND is ON in production: any treasurer session can trigger sandbox spends. Turn it off after the demo. !!!');
  }

  const gate: RequestHandler = (_req, res, next) => {
    if (!enabled) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    next();
  };

  router.post('/spend', gate, requireTreasurer(env), async (req, res) => {
    const body = Body.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ error: `body must be { amountMinor (1 to ${DEMO_SPEND_MAX_MINOR}), label }`, issues: body.error.issues });
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
      const { amountMinor, label, category, vendor, referenceId, eventId } = body.data;
      const outcome = await ctx.executor.requestSpend({
        referenceId: referenceId ?? `demo-${randomUUID()}`,
        amountMinor,
        currency: 'USD',
        actor: `demo:${treasurerActor(res)}`,
        reason: `Demo spend: ${label}`,
        category,
        vendor,
        eventId,
      });
      res.status(STATUS[outcome.status]).json(outcome);
    } catch (err) {
      console.error('demo spend failed', err);
      res.status(500).json({ error: 'demo spend failed' });
    }
  });

  return router;
}
