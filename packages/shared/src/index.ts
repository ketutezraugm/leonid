import { z } from 'zod';

// API contract shared by apps/web and apps/api. Change by pull request only.

export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export * from './common.js';
export * from './sponsor.js';
export * from './invoice.js';
export * from './ledger.js';
export * from './payout.js';
export * from './claim.js';
export * from './widgets.js';
