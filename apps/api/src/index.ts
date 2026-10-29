import { createApp } from './app.js';
import { assertDurableMoneyState, getPayments } from './payments/context.js';
import { registerLedgerHandlers } from './webhooks/handlers/index.js';
import { registerHandler } from './webhooks/registry.js';
import { orderApprovedHandler } from './webhooks/orderApproved.js';

assertDurableMoneyState(); // fail the deploy rather than run production on in-memory money state

// Once per process (not in createApp, which tests call many times).
registerHandler('CHECKOUT.ORDER.APPROVED', orderApprovedHandler(getPayments));
registerLedgerHandlers();

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
