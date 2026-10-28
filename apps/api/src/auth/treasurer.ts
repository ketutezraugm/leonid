import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { readSession } from './session.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

// Treasurer-only routes accept a Log in with PayPal session (F1). The shared secret in the x-treasurer-token header
// stays as an ops/script fallback (live checks, curl) and only works while TREASURER_TOKEN is set; unset it to turn it off.
// Fails closed: with neither SESSION_SECRET nor TREASURER_TOKEN configured, every guarded route answers 503.
export function requireTreasurer(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  return (req, res, next) => {
    const secret = env.SESSION_SECRET;
    const expected = env.TREASURER_TOKEN;
    if (!secret && !expected) {
      res.status(503).json({ error: 'treasurer access is not configured' });
      return;
    }
    if (secret && secret.length >= 32 && readSession(req, secret)) {
      next();
      return;
    }
    // Compare fixed-length digests so the comparison time does not leak how much of the token matched.
    if (expected && timingSafeEqual(digest(req.header('x-treasurer-token') ?? ''), digest(expected))) {
      next();
      return;
    }
    res.status(401).json({ error: 'treasurer only' });
  };
}
