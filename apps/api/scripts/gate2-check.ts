// Gate 2 rehearsal against a deployed server (default: staging), through its own HTTP API.
//
//   pnpm --filter @quartermaster/api gate2:check                         $140 auto-pays, $420 opens an approval
//   pnpm --filter @quartermaster/api gate2:check -- --finish <approvalId> capture it, then the kill switch
//   pnpm --filter @quartermaster/api gate2:check -- --finish <id> --keep-wallet    capture only, no kill switch
//   pnpm --filter @quartermaster/api gate2:check -- --connect             a fresh link to connect the agent wallet
//
// Between the two runs the treasurer approves the $420 order in the PayPal page this script prints.
// Needs STAGING_TREASURER_TOKEN in .env, and DEMO_SPEND=true on the server (POST /api/demo/spend).
// Optional, for stronger checks: STAGING_DATABASE_URL (audit rows, the wallet's token id) and the Procurement
// credentials (the order status and the token at PayPal). GATE2_BASE_URL points it at another deployment.
// It prints no secrets. The kill-switch step revokes the agent wallet: reconnect with --connect afterwards.
import postgres from 'postgres';
import { z } from 'zod';
import { getPayPalClient, isPayPalAppConfigured } from '../src/paypal/client.js';
import { PayPalApiError } from '../src/paypal/errors.js';

const BASE = (process.env.GATE2_BASE_URL ?? 'https://quartermaster-staging.onrender.com').replace(/\/$/, '');
const TOKEN = process.env.STAGING_TREASURER_TOKEN;
const args = process.argv.slice(2);
const finishId = args.includes('--finish') ? args[args.indexOf('--finish') + 1] : undefined;

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  ${detail}` : ''}`);
  return ok;
};
const stop = (message: string): never => {
  console.log(`\n✗ ${message}`);
  process.exit(1);
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-treasurer-token': TOKEN!, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000), // a free Render instance can take a minute to wake
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON (an HTML 404 from a server that lacks the route)
  }
  return { status: res.status, json };
}

const procurement = isPayPalAppConfigured('procurement') ? getPayPalClient('procurement') : undefined;
const db = process.env.STAGING_DATABASE_URL
  ? postgres(process.env.STAGING_DATABASE_URL, { prepare: false, max: 1, connect_timeout: 20 })
  : undefined;
const auditOutcome = async (referenceId: string) =>
  db ? (await db`select outcome from audit_log where action = 'spend.check' and input->>'referenceId' = ${referenceId} order by created_at desc limit 1`)[0]?.outcome : undefined;

async function preflight() {
  if (!TOKEN) stop('STAGING_TREASURER_TOKEN is not set in .env');
  console.log(`Gate 2 rehearsal against ${BASE}\n`);
  const health = await api('GET', '/api/health');
  if (!check(health.status === 200, 'server is up', `(${health.status})`)) stop('server is not answering');
  const wallet = await api('GET', '/api/wallet');
  if (!check(wallet.status === 200, 'treasurer token accepted', `(${wallet.status})`)) stop('GET /api/wallet failed: wrong token, or the database is not reachable from the server');
  return wallet.json.status as string;
}

async function connect() {
  const res = await api('POST', '/api/wallet/connect');
  if (res.status === 409) {
    console.log('The agent wallet is already active. Nothing to connect.');
    return;
  }
  if (!check(res.status === 200, 'created a wallet approval link', `(${res.status})`)) return;
  console.log(`\nOpen in a private window, log in as the sandbox PERSONAL payer and agree:\n  ${String(res.json.approveUrl)}\nIt returns to ${BASE}/?wallet=connected`);
}

async function beats() {
  const status = await preflight();
  const probe = await api('POST', '/api/demo/spend', {});
  if (!check(probe.status === 422, 'demo spend route is enabled', `(${probe.status})`)) stop('POST /api/demo/spend answered something other than 422: deploy the demo-spend branch and set DEMO_SPEND=true');
  if (!check(status === 'active', 'agent wallet is active', `(${status})`)) stop('connect the wallet first: run with --connect');

  const run = Date.now();
  const auto = `gate2-${run}-140`;
  const paid = await api('POST', '/api/demo/spend', { amountMinor: 14_000, label: 'Lanyards (200)', category: 'swag', vendor: 'Lanyard Co', referenceId: auto });
  check(paid.status === 200 && paid.json.status === 'paid', '$140 auto-paid', paid.status === 200 ? `capture ${String(paid.json.captureId)}` : `(${paid.status}) ${JSON.stringify(paid.json)}`);
  const asked = `gate2-${run}-420`;
  const held = await api('POST', '/api/demo/spend', { amountMinor: 42_000, label: 'Prize cart', category: 'prizes', vendor: 'Prize Co', referenceId: asked });
  const opened = check(held.status === 202 && held.json.status === 'needs_approval', '$420 opened an approval and charged nothing', `(${held.status})`);

  if (db) {
    check((await auditOutcome(auto)) === 'paid', 'audit: $140 recorded as paid');
    check((await auditOutcome(asked)) === 'needs_approval', 'audit: $420 recorded as needs_approval');
  }
  if (opened) {
    console.log(`\nNow approve the $420 order. Open in a private window and log in as the sandbox PERSONAL payer:\n  https://www.sandbox.paypal.com/checkoutnow?token=${String(held.json.paypalOrderId)}\n(The page may keep reloading after you approve; that is cosmetic.) Then run:\n  pnpm --filter @quartermaster/api gate2:check -- --finish ${String(held.json.approvalId)}`);
  }
}

async function finish(approvalId: string) {
  const status = await preflight();
  const listed = await api('GET', '/api/approvals');
  const approvals = (listed.json.approvals as Array<{ id: string; status: string; paypalOrderId?: string }> | undefined) ?? [];
  const approval = approvals.find((a) => a.id === approvalId);
  if (!check(Boolean(approval), 'approval found', approval ? `(${approval.status})` : '')) stop('no such approval');

  if (procurement && approval?.paypalOrderId && approval.status === 'pending') {
    const order = await procurement.request({ method: 'GET', path: `/v2/checkout/orders/${approval.paypalOrderId}`, schema: z.looseObject({ status: z.string() }) });
    if (!check(order.status === 'APPROVED', 'PayPal shows the order as approved', `(${order.status})`)) stop('approve the order in the PayPal page first');
  }

  const cap = await api('POST', `/api/approvals/${approvalId}/capture`);
  const lateWinner = cap.status === 409 && (cap.json.reason === 'already_paid' || cap.json.reason === 'in_progress');
  check((cap.status === 200 && cap.json.status === 'paid') || lateWinner, '$420 captured', cap.status === 200 ? `capture ${String(cap.json.captureId)}` : lateWinner ? '(already captured, by the CHECKOUT.ORDER.APPROVED webhook or an earlier run)' : `(${cap.status}) ${JSON.stringify(cap.json)}`);
  const after = ((await api('GET', '/api/approvals')).json.approvals as Array<{ id: string; status: string }> | undefined)?.find((a) => a.id === approvalId);
  check(after?.status === 'paid', 'approval is marked paid', `(${after?.status})`);

  if (args.includes('--keep-wallet')) {
    console.log('\nKill switch skipped (--keep-wallet).');
    return;
  }
  if (status !== 'active') {
    check(false, 'kill switch needs an active wallet', `(${status})`);
    return;
  }
  const token = db ? (await db`select payment_token_id from agent_wallet where status = 'active'`)[0]?.payment_token_id : undefined;
  const revoke = await api('POST', '/api/wallet/revoke');
  check(revoke.status === 200 && revoke.json.revoked === true, 'kill switch: wallet revoked', `(${revoke.status})`);
  check((await api('GET', '/api/wallet')).json.status === 'revoked', 'wallet shows as revoked');
  const refused = await api('POST', '/api/demo/spend', { amountMinor: 14_000, label: 'After the kill switch', referenceId: `gate2-${Date.now()}-after-kill` });
  check(refused.status === 409 && refused.json.reason === 'no_wallet', 'a spend after the kill switch is refused', `(${refused.status})`);
  if (procurement && token) {
    const gone = await procurement.request({ method: 'GET', path: `/v3/vault/payment-tokens/${encodeURIComponent(String(token))}`, schema: z.unknown() }).then(
      () => 'still there',
      (err: unknown) => (err instanceof PayPalApiError ? `${err.status} ${err.issue ?? err.errorName}` : 'error'),
    );
    check(gone.startsWith('404'), 'PayPal no longer has the payment token', `(${gone})`);
  } else {
    console.log('- skipped: PayPal token check (needs STAGING_DATABASE_URL and the Procurement credentials in .env)');
  }
  console.log('\nThe agent wallet is now revoked. To demo again: gate2:check -- --connect');
}

try {
  if (args.includes('--connect')) {
    if (!TOKEN) stop('STAGING_TREASURER_TOKEN is not set in .env');
    await connect();
  } else if (finishId) await finish(finishId);
  else await beats();
} finally {
  await db?.end({ timeout: 2 });
}
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
