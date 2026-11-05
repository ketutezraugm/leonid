import type { Request } from 'express';

// How many proxies sit between a visitor and the app on Render, so Express picks the visitor from X-Forwarded-For and not a proxy.
// Measured on staging on Nov 5 2026 with a spoofed X-Forwarded-For: the header reached the app as
//   <spoofed>, <visitor>, <Cloudflare edge>, <Render internal proxy>
// and the connection itself came from one more Render hop, so the visitor is the third address counted from the right. A trust
// proxy of 1 (the earlier guess) resolved to the Render internal address for everyone, putting every judge in one rate-limit bucket.
// Anything the visitor sent as X-Forwarded-For stays left of the visitor entry and is ignored. Re-measure (GET /api/ops/client-ip
// was the probe) if the service gets a custom domain or another CDN in front.
export const TRUSTED_PROXY_HOPS = 3;

export interface RateLimiter {
  // True when the request is allowed.
  take(req: Request): boolean;
}

// In-memory fixed window per client IP. Enough to stop judges exhausting the hosted demo's LLM
// quota (agents.md); a multi-instance deploy would need a shared store.
export function createRateLimiter({
  max,
  windowMs,
  now = Date.now,
}: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const windows = new Map<string, { resetAt: number; count: number }>();
  return {
    take(req) {
      const key = req.ip ?? 'unknown';
      const t = now();
      const current = windows.get(key);
      if (!current || current.resetAt <= t) {
        windows.set(key, { resetAt: t + windowMs, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= max;
    },
  };
}
