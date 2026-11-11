# P2 Day-1 runbook (Oct 27-28): PayPal + Render setup and tests

Local only. Never commit this folder. Secrets go in `paypal-hack/.env` (gitignored), never in chat, PRs or issues.

Dashboard labels change often. Where a label below is marked (verify), look for the closest match.

## A. PayPal developer dashboard (Ezra, manual)

Sign in at developer.paypal.com with the new developer account.

### A1. Sandbox accounts (Testing Tools > Sandbox Accounts > Create account)

Every account: **country = United States** (Vault is US-only). Note the generated email and password into `.env`.

| Purpose | Type | `.env` keys |
| --- | --- | --- |
| Treasury (the event's business account) | Business | used by the Treasury app, no login needed in `.env` |
| Procurement (Leonid merchant) | Business | used by the Procurement app |
| Treasurer payer wallet | Personal | `SANDBOX_TREASURER_EMAIL/PASSWORD` |
| Sponsor 1, 2, 3 | Personal (or Business) | `SANDBOX_SPONSOR_{1,2,3}_EMAIL/PASSWORD` |
| Volunteer / speaker / winner | Personal x3 | `SANDBOX_VOLUNTEER_EMAIL/PASSWORD` (+ speaker, winner) |

Day-1 question for the vault test: can the **Treasury business account** be the payer wallet? If the vault flow rejects it, fall back to the treasurer personal account (PRD section 14 fallback).

### A2. Apps (Apps & Credentials > Sandbox > Create App)

Create two apps:

1. **Leonid Treasury** (Merchant, sandbox business = Treasury account). Features to enable (verify names):
   - Log in with PayPal (Advanced settings: Return URL = the Render URL + `/api/auth/paypal/callback`, scopes openid, email, account verification status + PayPal account ID; privacy/terms URLs can be `https://example.com`)
   - Transaction Search (needed for `reporting/balances/read`)
   - Invoicing, Payouts
2. **Leonid Procurement** (Merchant, sandbox business = Procurement account). Features:
   - Save payment methods / Vault (verify), Accept payments (Orders)
   - Disputes if offered

Copy each Client ID and Secret into `.env`:
`PAYPAL_TREASURY_CLIENT_ID/SECRET`, `PAYPAL_PROCUREMENT_CLIENT_ID/SECRET`.

### A3. Webhooks (per app, after the Render URL exists)

Add a listener URL on each app and subscribe to the 10 events from the PRD (section 6). Copy each Webhook ID into `.env`:

- Treasury: `{RENDER_URL}/api/webhooks/paypal/treasury` -> `PAYPAL_TREASURY_WEBHOOK_ID`
- Procurement: `{RENDER_URL}/api/webhooks/paypal/procurement` -> `PAYPAL_PROCUREMENT_WEBHOOK_ID`

Events: INVOICING.INVOICE.PAID, PAYMENT.CAPTURE.COMPLETED, CHECKOUT.ORDER.APPROVED, VAULT.PAYMENT-TOKEN.CREATED, VAULT.PAYMENT-TOKEN.DELETED, VAULT.PAYMENT-TOKEN.DELETION-INITIATED, PAYMENT.PAYOUTSBATCH.SUCCESS, PAYMENT.CAPTURE.REFUNDED, BILLING.SUBSCRIPTION.ACTIVATED, CUSTOMER.DISPUTE.CREATED.

## B. Smoke check: tokens and scopes (I run this once `.env` is filled)

```sh
curl -s -u "$PAYPAL_PROCUREMENT_CLIENT_ID:$PAYPAL_PROCUREMENT_CLIENT_SECRET" \
  -d grant_type=client_credentials https://api-m.sandbox.paypal.com/v1/oauth2/token
```

I print only the `scope` field, never `access_token`. Expect the Vault scope on Procurement and the reporting scope on Treasury. A missing scope means a feature isn't enabled on the app.

## C. Day-1 tests (record each result in `RESULTS.md`, same folder)

All with Procurement unless noted. Headers on every call: `Authorization: Bearer <token>`, `Content-Type: application/json`; POSTs also get `PayPal-Request-Id: <unique>`.

1. **Setup token.** `POST /v3/vault/setup-tokens`:

   ```json
   {
     "payment_source": {
       "paypal": {
         "usage_type": "MERCHANT",
         "customer_type": "CONSUMER",
         "permit_multiple_payment_tokens": true,
         "experience_context": {
           "return_url": "{RENDER_URL}/api/wallet/return",
           "cancel_url": "{RENDER_URL}/api/wallet/cancel"
         }
       }
     }
   }
   ```

   Open the `approve` link in a browser, log in as the payer, approve.
2. **Payment token.** `POST /v3/vault/payment-tokens` with `{"payment_source":{"token":{"id":"<SETUP_TOKEN_ID>","type":"SETUP_TOKEN"}}}`. Save `id` and `customer.id`.
3. **Charge with no buyer present.** `POST /v2/checkout/orders`:

   ```json
   {
     "intent": "CAPTURE",
     "purchase_units": [{ "amount": { "currency_code": "USD", "value": "10.00" } }],
     "payment_source": { "paypal": { "vault_id": "<PAYMENT_TOKEN_ID>" } }
   }
   ```

   Expected: status COMPLETED. If it fails, the PRD fallback is supervised approval for every cart.
4. **Business account as payer.** Repeat 1-3 with the Treasury business account as the approving payer.
5. **Kill switch.** `DELETE /v3/vault/payment-tokens/<PAYMENT_TOKEN_ID>` (expect 204), then immediately repeat step 3. Expected: PayPal rejects it. Record whether the rejection is immediate (the `VAULT.PAYMENT-TOKEN.DELETION-INITIATED` event suggests deletion can be asynchronous).
6. **Webhooks.** Send simulator events from the dashboard to both URLs. Simulator events use webhook id `WEBHOOK_ID` and cannot use postback verification, so confirm they pass through the self-verify path.
7. **Login with PayPal.** Hit the authorize URL, log in with the treasurer account, exchange the code, call both userinfo paths (`/v1/identity/oauth2/userinfo?schema=paypalv1.1` and `/v1/identity/openidconnect/userinfo?schema=openid`). Record which returns payer ID and verification status.
8. **Return URLs.** Check whether the app accepts more than one Return URL (staging and prod).
9. **Balance.** `GET /v1/reporting/balances` on Treasury; record the `account_id` and the lag.
10. **Payouts to Venmo** (Jose owns it, but note the result): `recipient_wallet: VENMO` plus a sandbox phone number.

## D. Render (Ezra, manual + me)

1. `render login` (run it with the `!` prefix in the Claude Code prompt so it can open a browser).
2. Authorize the Render MCP once through `/mcp`.
3. Check Billing: the $50 credit **expiry date**; set a spend alert at $35.
4. Invite Jose, Abel and Harfi to the workspace. Ask Harfi to install the Render GitHub app on the repo (or make you an admin).
5. Services: prod (`main`), staging (`development`), later a workflow service and a cron service. I update `render.yaml` and validate the Blueprint with `render blueprints validate` (verify the subcommand).
6. Set env vars on both services in the dashboard (never in git). Mark the PayPal secrets `sync: false`.

## E. Local machine

- Start Docker Desktop, then `docker compose up -d` once the compose file lands on `p2/db-setup`.
- `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`.
- Local login uses the demo button only. PayPal login and real webhooks are tested on Render.
