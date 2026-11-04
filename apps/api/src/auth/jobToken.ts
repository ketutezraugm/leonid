import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

const digest = (s: string) => createHash('sha256').update(s).digest();

// The Render Workflows service calls /api/jobs/* with a shared secret in the x-job-token header. It is a separate secret from
// the treasurer's, so a leak of one does not open the other. Fails closed: with no JOBS_TOKEN (or a short one) every job
// endpoint answers 503, and the browser can never reach them with a login session.
export const JOBS_TOKEN_MIN_LENGTH = 32;

export function requireJobToken(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  return (req, res, next) => {
    const expected = env.JOBS_TOKEN;
    if (!expected || expected.length < JOBS_TOKEN_MIN_LENGTH) {
      res.status(503).json({ error: 'jobs are not configured' });
      return;
    }
    // Fixed-length digests, so the comparison time does not leak how much of the token matched.
    if (!timingSafeEqual(digest(req.header('x-job-token') ?? ''), digest(expected))) {
      res.status(401).json({ error: 'not allowed' });
      return;
    }
    next();
  };
}
