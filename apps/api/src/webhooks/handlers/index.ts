import { getDb } from '../../db/client.js';
import type { Db } from '../../db/client.js';
import { registerHandler, type WebhookHandler } from '../registry.js';
import { createCaptureCompletedHandler } from './capture-completed.js';
import { createCaptureReversalHandler, INCOME_REVERSAL_EVENTS } from './capture-reversed.js';
import { createInvoicePaidHandler } from './invoice-paid.js';

type Register = (eventType: string, handler: WebhookHandler) => void;

// Registers P3's ledger handlers. Called once per process from index.ts, not from createApp(), so tests
// that build the app never get DB-bound handlers. getDb is passed lazily, so registering never needs
// DATABASE_URL; a missing one only fails an event. Every handler ignores the Procurement app, so other
// owners' handlers for the same event type (P4's PAYMENT.CAPTURE.REFUNDED late-delivery case) coexist.
export function registerLedgerHandlers(register: Register = registerHandler, db: () => Db = getDb) {
  register('INVOICING.INVOICE.PAID', createInvoicePaidHandler(db));
  register('PAYMENT.CAPTURE.COMPLETED', createCaptureCompletedHandler(db));
  const reversal = createCaptureReversalHandler(db);
  for (const eventType of INCOME_REVERSAL_EVENTS) register(eventType, reversal);
}
