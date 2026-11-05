import { Router } from 'express';
import { z } from 'zod';
import { requireTreasurer } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { errorLabel, getReportByToken, getReportLink } from '../reports/store.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';

export interface ReportsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  limiter?: RateLimiter;
}

// Sponsor spend reports (F22).
//   GET /:shareToken        PUBLIC. The report at its unguessable link (what the /report/:shareToken page reads). Not found for a
//                           token that is malformed or unknown. Never cached or indexed, and the link is not passed on in Referer.
//   GET /link/:sponsorId    (treasurer) { shareToken, generatedAt }: the link to send the sponsor. 404 until a report is published
//                           (start the "sponsor-reports" workflow).
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export function reportsRouter(options: ReportsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const limiter = options.limiter ?? createRateLimiter({ max: 60, windowMs: 10 * 60_000 });
  const router = Router();

  router.get('/link/:sponsorId', requireTreasurer(env), async (req, res) => {
    if (!z.uuid().safeParse(req.params.sponsorId).success) {
      res.status(400).json({ error: 'sponsor id must be a UUID' });
      return;
    }
    try {
      const link = await getReportLink((options.db ?? getDb)(), String(req.params.sponsorId));
      if (!link) {
        res.status(404).json({ error: 'No report is published for this sponsor yet' });
        return;
      }
      res.json({ shareToken: link.shareToken, generatedAt: link.generatedAt.toISOString() });
    } catch (err) {
      console.error('report link failed:', errorLabel(err));
      res.status(500).json({ error: 'could not read the report link' });
    }
  });

  router.get('/:shareToken', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
    if (!limiter.take(req)) {
      res.status(429).json({ error: 'Too many requests. Wait a few minutes and try again.' });
      return;
    }
    const token = String(req.params.shareToken);
    if (!TOKEN.test(token)) {
      res.status(404).json({ error: 'No such report' });
      return;
    }
    try {
      const report = await getReportByToken((options.db ?? getDb)(), token);
      if (!report) {
        res.status(404).json({ error: 'No such report' });
        return;
      }
      res.json(report);
    } catch (err) {
      console.error('report read failed:', errorLabel(err));
      res.status(500).json({ error: 'could not read the report' });
    }
  });

  return router;
}
