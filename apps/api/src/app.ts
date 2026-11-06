import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { HealthResponse } from '@quartermaster/shared';
import { approvalsRouter } from './routes/approvals.js';
import { authRouter } from './routes/auth.js';
import { checkoutRouter } from './routes/checkout.js';
import { chatRouter } from './routes/chat.js';
import { demoRouter } from './routes/demo.js';
import { eventsRouter } from './routes/events.js';
import { invoicesRouter } from './routes/invoices.js';
import { jobsRouter } from './routes/jobs.js';
import { reportsRouter } from './routes/reports.js';
import { spendsRouter } from './routes/spends.js';
import { treasuryRouter } from './routes/treasury.js';
import { venueDepositRouter } from './routes/venueDeposit.js';
import { TRUSTED_PROXY_HOPS } from './routes/rateLimit.js';
import { walletRouter } from './routes/wallet.js';
import { walletPoolRouter } from './routes/walletPool.js';
import { widgetsRouter } from './routes/widgets.js';
import { workflowsRouter } from './routes/workflows.js';
import { webhookRouter } from './webhooks/router.js';

export function createApp() {
  const app = express();
  // Without this req.ip is a Render proxy for everyone and the per-IP rate limits become one shared bucket (hop count: rateLimit.ts).
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', TRUSTED_PROXY_HOPS);
  app.use(cors());
  // Before express.json(): PayPal webhook signatures are checked against the raw request body.
  app.use('/api/webhooks/paypal', webhookRouter());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'quartermaster-api',
      time: new Date().toISOString(),
    };
    res.json(body);
  });

  app.use('/api/auth', authRouter());
  app.use('/api/chat', chatRouter);
  app.use('/api/checkout', checkoutRouter());
  app.use('/api/demo', demoRouter());
  app.use('/api/events', eventsRouter());
  app.use('/api/jobs', jobsRouter());
  app.use('/api/reports', reportsRouter());
  app.use('/api/spends', spendsRouter());
  app.use('/api/treasury', treasuryRouter());
  app.use('/api/wallet/pool', walletPoolRouter());
  app.use('/api/wallet', walletRouter());
  app.use('/api/approvals', approvalsRouter());
  app.use('/api/sponsors', invoicesRouter());
  app.use('/api/venue-deposit', venueDepositRouter());
  app.use('/api/widgets', widgetsRouter());
  app.use('/api/workflows', workflowsRouter());

  // In production the API also serves the built web app (one Render service).
  if (process.env.NODE_ENV === 'production') {
    const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return app;
}
