import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { clientIpRouter } from './clientIp.js';

const env = { TREASURER_TOKEN: 'letmein' };

describe('client ip probe (temporary)', () => {
  it('is treasurer-only', async () => {
    const app = express();
    app.use('/api/ops/client-ip', clientIpRouter(env));
    expect((await request(app).get('/api/ops/client-ip')).status).toBe(401);
  });

  it('reports what the proxy chain looks like to the server, and which entry trust proxy picks', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use('/api/ops/client-ip', clientIpRouter(env));
    const res = await request(app).get('/api/ops/client-ip').set('x-treasurer-token', 'letmein').set('x-forwarded-for', '9.9.9.9, 203.0.113.7');
    expect(res.body).toMatchObject({ ip: '203.0.113.7', ips: ['203.0.113.7'], trustProxy: 1, xForwardedFor: '9.9.9.9, 203.0.113.7', cfConnectingIp: null });
  });
});
