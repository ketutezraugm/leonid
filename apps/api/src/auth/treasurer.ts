import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

const digest = (s: string) => createHash('sha256').update(s).digest();

// Interim guard until Log in with PayPal sessions (F1) exist: a shared secret in the x-treasurer-token header.
// Fails closed: with no TREASURER_TOKEN configured, every guarded route answers 503.
export function requireTreasurer(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  return (req, res, next) => {
    const expected = env.TREASURER_TOKEN;
    if (!expected) {
      res.status(503).json({ error: 'treasurer access is not configured' });
      return;
    }
    const got = req.header('x-treasurer-token') ?? '';
    // Compare fixed-length digests so the comparison time does not leak how much of the token matched.
    if (!timingSafeEqual(digest(got), digest(expected))) {
      res.status(401).json({ error: 'treasurer only' });
      return;
    }
    next();
  };
}
