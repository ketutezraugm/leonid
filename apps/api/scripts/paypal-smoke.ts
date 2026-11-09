// Day-1 sandbox check (PRD §14), following PayPal's "Getting started with the PayPal sandbox" guide.
//
//   pnpm --filter @leonid/api paypal:smoke             credentials, a $1.00 order, negative test
//   pnpm --filter @leonid/api paypal:smoke <orderId>   show an order's status after you approve it
//
// It never captures: capture moves money and only the rules-engine executor may call it.
import { getPayPalClient, isPayPalAppConfigured, type PayPalApp } from '../src/paypal/client.js';
import { PayPalApiError } from '../src/paypal/errors.js';
import { createOrder, getOrder } from '../src/paypal/orders.js';

const APPS: PayPalApp[] = ['treasury', 'procurement'];

async function checkCredentials(): Promise<boolean> {
  let ok = true;
  for (const app of APPS) {
    if (!isPayPalAppConfigured(app)) {
      console.log(`- ${app}: not configured (see .env.example)`);
      ok = false;
      continue;
    }
    try {
      await getPayPalClient(app).getAccessToken();
      console.log(`✓ ${app}: OAuth token issued`);
    } catch (err) {
      console.log(`✗ ${app}: ${err instanceof Error ? err.message : String(err)}`);
      ok = false;
    }
  }
  return ok;
}

async function createTestOrder(): Promise<void> {
  const treasury = getPayPalClient('treasury');
  const order = await createOrder(treasury, {
    referenceId: `smoke-${Date.now()}`,
    amountMinor: 100,
    currency: 'USD',
    description: 'Leonid sandbox smoke test',
  });
  console.log(`✓ order ${order.id} created (${order.status})`);
  console.log(`  Approve it as your sandbox Personal (buyer) account:\n  ${order.approveUrl}`);
  console.log(`  Then run: pnpm --filter @leonid/api paypal:smoke ${order.id}`);
}

async function negativeTest(): Promise<void> {
  try {
    await createOrder(getPayPalClient('treasury'), {
      referenceId: `smoke-negative-${Date.now()}`,
      amountMinor: 100,
      currency: 'USD',
      mockApplicationCode: 'DUPLICATE_INVOICE_ID',
    });
    console.log(
      '? negative test: PayPal ignored the mock code for create order, so no error came back',
    );
  } catch (err) {
    if (!(err instanceof PayPalApiError)) throw err;
    console.log(
      `✓ negative test: ${err.status} ${err.issue ?? err.errorName}, debug_id ${err.debugId ?? 'missing'}`,
    );
  }
}

async function showOrder(orderId: string): Promise<void> {
  const order = await getOrder(getPayPalClient('treasury'), orderId);
  console.log(`order ${order.id}: ${order.status}`);
  if (order.status === 'APPROVED') {
    console.log('  Buyer approval works. Capture happens through the executor, not this script.');
  }
}

async function main(): Promise<void> {
  const orderId = process.argv[2];
  if (orderId) return showOrder(orderId);

  const ok = await checkCredentials();
  if (!isPayPalAppConfigured('treasury')) {
    process.exitCode = 1;
    return;
  }
  await createTestOrder();
  await negativeTest();
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
