import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { HealthResponse } from '@quartermaster/shared';
import { chatRouter } from './routes/chat.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'quartermaster-api',
      time: new Date().toISOString(),
    };
    res.json(body);
  });

  app.use('/api/chat', chatRouter);

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
