import { createApp } from './app.js';
import { getPayments } from './payments/context.js';
import { registerHandler } from './webhooks/registry.js';
import { orderApprovedHandler } from './webhooks/orderApproved.js';

// Once per process (not in createApp, which tests call many times).
registerHandler('CHECKOUT.ORDER.APPROVED', orderApprovedHandler(getPayments));

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
