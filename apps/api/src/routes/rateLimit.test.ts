import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createRateLimiter, TRUSTED_PROXY_HOPS } from './rateLimit.js';

// The header chain measured on Render staging on Nov 5 2026 (a caller-supplied 9.9.9.9 first, then the visitor, a Cloudflare edge
// and Render's internal proxy; the connection itself came from one more Render hop, which supertest plays with its loopback socket).
const chain = (visitor: string) => `9.9.9.9,${visitor}, 172.68.174.79, 10.25.162.12`;

describe('client address behind Render', () => {
  it('picks the visitor, not a proxy, and ignores an address the visitor put in X-Forwarded-For', async () => {
    const app = express();
    app.set('trust proxy', TRUSTED_PROXY_HOPS);
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    expect((await request(app).get('/ip').set('x-forwarded-for', chain('118.99.73.114'))).body.ip).toBe('118.99.73.114');
    expect((await request(app).get('/ip').set('x-forwarded-for', chain('203.0.113.9'))).body.ip).toBe('203.0.113.9');
  });

  it('gives two visitors two rate-limit buckets, so one judge cannot lock out the others', async () => {
    const app = express();
    app.set('trust proxy', TRUSTED_PROXY_HOPS);
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    app.get('/limited', (req, res) => res.status(limiter.take(req) ? 200 : 429).end());
    const as = (visitor: string) => request(app).get('/limited').set('x-forwarded-for', chain(visitor));
    expect((await as('118.99.73.114')).status).toBe(200);
    expect((await as('118.99.73.114')).status).toBe(429);
    expect((await as('203.0.113.9')).status).toBe(200);
  });

  it('is what the production app uses', async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(createApp().get('trust proxy')).toBe(TRUSTED_PROXY_HOPS);
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
