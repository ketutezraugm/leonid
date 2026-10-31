---
paths:
  - 'apps/api/src/paypal/**'
  - 'apps/api/src/webhooks/**'
  - 'apps/web/src/approvals/**'
  - 'apps/web/src/pages/Approvals.tsx'
---

# PayPal integration

Owners: P2 (Identity, vault, spend orders, kill switch, tickets), P3 (Invoicing, Payouts, Transaction Search, subscriptions), P4 (tracking, refunds, disputes). Sandbox only, base URL `https://api-m.sandbox.paypal.com`. Check endpoint shapes against PayPal docs or the APIMatic Context Plugin; do not recall them from memory.

## Two apps, two clients

| Client        | Credentials                           | APIs                                                                                                                   |
| ------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `treasury`    | `PAYPAL_TREASURY_CLIENT_ID/SECRET`    | Log in with PayPal (Identity), Invoicing v2, Orders v2 (tickets/donations), Subscriptions, Payouts, Transaction Search |
| `procurement` | `PAYPAL_PROCUREMENT_CLIENT_ID/SECRET` | Vault v3 payment tokens, Orders v2 spend (`vault_id` or approval link), tracking, refunds, disputes                    |

Never mix them. Money in always lands in the treasury; the treasury pays Procurement for goods and pays people directly through Payouts.

## Client rules

- Fetch an OAuth token per app with client credentials and cache it until shortly before `expires_in`.
- Send a `PayPal-Request-Id` header on every POST that creates or moves money, derived from our own record ID (cart, payout batch, refund). Retries then cannot double-charge or double-pay. Payouts also use a stable `sender_batch_id`.
- Amounts arrive as integer cents and are converted to `{ currency_code, value: "140.00" }` here, and nowhere else.
- Parse every response with zod. Log PayPal's `debug_id` on errors.
- The functions that move money (capture, vault charge, payout, refund) are called only by the rules-engine executor. See `money-safety.md`.

## Webhooks

- One receiver per app. Verify every event with `POST /v1/notifications/verify-webhook-signature` before acting. Reject unverified events, but keep the demo simulator path working in sandbox.
- Handlers are idempotent, keyed by the event `id`, because PayPal retries.

| Event                            | Action                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| `INVOICING.INVOICE.PAID`         | Ledger income; unlock the sponsor's budget share; release gated Gantt tasks |
| `PAYMENT.CAPTURE.COMPLETED`      | Record income or spend; update the dashboard                                |
| `CHECKOUT.ORDER.APPROVED`        | Capture the approved cart (through the executor)                            |
| `VAULT.PAYMENT-TOKEN.CREATED`    | Mark the agent wallet active                                                |
| `VAULT.PAYMENT-TOKEN.DELETED`    | Confirm the kill switch; disable agent spending                             |
| `PAYMENT.PAYOUTSBATCH.SUCCESS`   | Mark claims, speaker payments or prizes as paid                             |
| `PAYMENT.CAPTURE.REFUNDED`       | Close the late-delivery case                                                |
| `BILLING.SUBSCRIPTION.ACTIVATED` | Add the recurring partner to the budget                                     |
| `CUSTOMER.DISPUTE.CREATED`       | Open a case in the audit log                                                |

## Kill switch (F15)

`DELETE /v3/vault/payment-tokens/{id}` on the procurement app, then set `agent_wallet.status = 'revoked'`. The next agent spend must fail because PayPal rejects it, not only because our flag says so. The demo shows that refusal.

## Day-1 fallbacks (PRD §14)

If a sandbox capability fails its day-1 test, use the documented fallback instead of faking success:

- Vault fails: every cart goes through supervised approval.
- Invoicing fails: Orders checkout link for sponsors.
- Tracking fails: store tracking in our DB.

## Prize evidence

The README's "PayPal capabilities used" table must link each of the 13 capabilities to its code path. Update it when you add one.
