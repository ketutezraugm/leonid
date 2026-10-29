import { Router } from 'express';
import { requireTreasurer } from '../auth/treasurer.js';
import { getTreasuryBalances } from '../paypal/balances.js';
import { getPayPalClient, isPayPalAppConfigured, type PayPalClient } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';

export interface TreasuryRouterOptions {
  env?: NodeJS.ProcessEnv;
  client?: () => PayPalClient;
}

// F2: the Treasury PayPal account connection, for the wallet card. Treasurer only.
//   GET /  -> TreasuryResponse (shared): merchant id, balances, and when PayPal last refreshed them
export function treasuryRouter(options: TreasuryRouterOptions = {}) {
  const env = options.env ?? process.env;
  const router = Router();

  router.get('/', requireTreasurer(env), async (_req, res) => {
    if (!options.client && !isPayPalAppConfigured('treasury', env)) {
      res.status(503).json({ error: 'PayPal Treasury app is not configured' });
      return;
    }
    try {
      res.json(await getTreasuryBalances((options.client ?? (() => getPayPalClient('treasury')))()));
    } catch (err) {
      console.error('treasury balances failed', err);
      res.status(err instanceof PayPalApiError ? 502 : 500).json({ error: 'treasury request failed' });
    }
  });

  return router;
}
