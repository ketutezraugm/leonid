import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@leonid/shared';
import { createApp } from './app.js';

describe('GET /api/health', () => {
  it('returns a valid health response', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(res.body).status).toBe('ok');
  });
});
