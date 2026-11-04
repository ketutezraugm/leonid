import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { HealthResponse } from '@quartermaster/shared';
import { approvalsRouter } from './routes/approvals.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { demoRouter } from './routes/demo.js';
import { invoicesRouter } from './routes/invoices.js';
import { spendsRouter } from './routes/spends.js';
import { treasuryRouter } from './routes/treasury.js';
import { venueDepositRouter } from './routes/venueDeposit.js';
import { walletRouter } from './routes/wallet.js';
import { widgetsRouter } from './routes/widgets.js';
import { webhookRouter } from './webhooks/router.js';

export function createApp() {
  const app = express();
  // Render puts one proxy in front: without this req.ip is the proxy for everyone and the per-IP rate limits become one shared bucket.
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
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
  app.use('/api/demo', demoRouter());
  app.use('/api/spends', spendsRouter());
  app.use('/api/treasury', treasuryRouter());
  app.use('/api/wallet', walletRouter());
  app.use('/api/approvals', approvalsRouter());
  app.use('/api/sponsors', invoicesRouter());
  app.use('/api/venue-deposit', venueDepositRouter());
  app.use('/api/widgets', widgetsRouter());

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
