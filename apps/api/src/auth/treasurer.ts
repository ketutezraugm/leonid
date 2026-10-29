import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { readSession, sessionSecret } from './session.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

// Who passed the guard. ops-token = the x-treasurer-token header (scripts, curl), not a person we can name.
export interface Treasurer {
  sub: string;
  via: 'paypal' | 'demo' | 'ops-token';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

// CSRF check for cookie sessions: a state-changing request must come from our own page. Browsers send Origin on
// non-GET requests; Referer is the fallback when Origin is missing. Fails closed: no APP_BASE_URL, no match.
function sameOrigin(req: Request, env: NodeJS.ProcessEnv): boolean {
  const expected = originOf(env.APP_BASE_URL);
  const got = req.header('origin') ?? originOf(req.header('referer'));
  return Boolean(expected && got && got === expected);
}

// Treasurer-only routes accept a Log in with PayPal session (F1). The shared secret in the x-treasurer-token header
// stays as an ops/script fallback (live checks, curl) and only works while TREASURER_TOKEN is set; unset it to turn it off.
// Fails closed: with neither SESSION_SECRET (>= 32 chars) nor TREASURER_TOKEN configured, every guarded route answers 503.
// On success res.locals.treasurer says who it is; routes put treasurerActor(res) into the audit log.
export function requireTreasurer(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  return (req, res, next) => {
    const secret = sessionSecret(env);
    const expected = env.TREASURER_TOKEN;
    if (!secret && !expected) {
      res.status(503).json({ error: 'treasurer access is not configured' });
      return;
    }
    // Compare fixed-length digests so the comparison time does not leak how much of the token matched.
    // A custom header already forces a CORS preflight, so this path needs no Origin check.
    if (expected && timingSafeEqual(digest(req.header('x-treasurer-token') ?? ''), digest(expected))) {
      setTreasurer(res, { sub: 'ops-token', via: 'ops-token' });
      next();
      return;
    }
    const session = secret ? readSession(req, secret) : null;
    if (session) {
      if (!SAFE_METHODS.has(req.method) && !sameOrigin(req, env)) {
        res.status(403).json({ error: 'cross-origin request refused' });
        return;
      }
      setTreasurer(res, { sub: session.sub, via: session.via });
      next();
      return;
    }
    res.status(401).json({ error: 'treasurer only' });
  };
}

function setTreasurer(res: Response, treasurer: Treasurer): void {
  res.locals.treasurer = treasurer;
}

// The treasurer the guard let through. Throws on an unguarded route rather than auditing an anonymous actor.
export function currentTreasurer(res: Response): Treasurer {
  const t = res.locals.treasurer as Partial<Treasurer> | undefined;
  if (!t || typeof t.sub !== 'string' || (t.via !== 'paypal' && t.via !== 'demo' && t.via !== 'ops-token')) {
    throw new Error('no treasurer on this request: is the route behind requireTreasurer?');
  }
  return { sub: t.sub, via: t.via };
}

// Audit actor for a treasurer action: treasurer:paypal:<sub>, treasurer:demo or treasurer:ops-token.
export function treasurerActor(res: Response): string {
  const t = currentTreasurer(res);
  return t.via === 'paypal' ? `treasurer:paypal:${t.sub}` : `treasurer:${t.via}`;
}
