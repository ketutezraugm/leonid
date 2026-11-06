import { SPEND_RECENT_MAX, type SpendsResponse } from '@quartermaster/shared';
import { Router } from 'express';
import { z } from 'zod';
import { currentTreasurer, ownerOf, requireTreasurer } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { getVisibleEvent, visibleEventIds } from '../db/events.js';
import { recentSpends } from '../payments/recent.js';

export interface SpendsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
}

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(SPEND_RECENT_MAX).default(20),
  eventId: z.uuid().optional(),
});

// Read-only view of what the payment executor decided, for Event home's "Recent spends". Treasurer only.
//   GET /recent?limit=20&eventId=<uuid>  -> SpendsResponse (shared); 404 for an event the caller cannot see.
//                                           With no eventId: the spends of every event the caller can see.
export function spendsRouter(options: SpendsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const router = Router();

  router.get('/recent', requireTreasurer(env), async (req, res) => {
    const query = Query.safeParse(req.query);
    if (!query.success) {
      res.status(422).json({ error: `limit must be 1 to ${SPEND_RECENT_MAX} and eventId a UUID` });
      return;
    }
    let db: Db;
    try {
      db = (options.db ?? getDb)();
    } catch {
      res.status(503).json({ error: 'database is not configured' });
      return;
    }
    try {
      const owner = ownerOf(currentTreasurer(res));
      if (query.data.eventId && !(await getVisibleEvent(db, query.data.eventId, owner))) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      const eventIds = owner === null || query.data.eventId ? undefined : await visibleEventIds(db, owner);
      const body: SpendsResponse = { spends: await recentSpends(db, { ...query.data, eventIds }) };
      res.json(body);
    } catch (err) {
      console.error('recent spends failed', err);
      res.status(500).json({ error: 'recent spends request failed' });
    }
  });

  return router;
}
