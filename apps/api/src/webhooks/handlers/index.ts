import { getDb } from '../../db/client.js';
import { registerHandler } from '../registry.js';
import { createCaptureCompletedHandler } from './capture-completed.js';
import { createInvoicePaidHandler } from './invoice-paid.js';

// Importing this file registers P3's webhook handlers on the shared registry (app.ts imports it once).
// getDb is passed lazily, so importing never needs DATABASE_URL; a missing one only fails an event.
registerHandler('INVOICING.INVOICE.PAID', createInvoicePaidHandler(getDb));
registerHandler('PAYMENT.CAPTURE.COMPLETED', createCaptureCompletedHandler(getDb));
