import type { Request } from 'express';

export interface RateLimiter {
  // True when the request is allowed. The window is kept per key, the client IP unless the caller names one.
  take(req: Request, key?: string): boolean;
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
    take(req, named) {
      const key = named ?? req.ip ?? 'unknown';
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
