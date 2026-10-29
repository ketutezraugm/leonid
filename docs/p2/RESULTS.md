# P2 day-1 test results (sandbox)

## 2026-10-27
- Treasury app: token OK; Invoicing, Payouts, reporting/search scopes present. `GET /v1/reporting/balances` -> 200 (USD 0.00).
- Procurement app, first attempt (Merchant, "Save payment methods" ticked): `POST /v3/vault/setup-tokens` -> 403 NOT_AUTHORIZED; token had 26 scopes, no `vault/payment-tokens`.
- Procurement app recreated (Merchant, Save payment methods ticked right after creation): token has 29 scopes incl. Vault v3; `POST /v3/vault/setup-tokens` -> 201 PAYER_ACTION_REQUIRED with approve link. **Vault v3 works.**
- Orders v2 create works on both apps (201).

## Vault flow, Personal sandbox payer (2026-10-27)
- Setup token approved by the Personal payer -> `POST /v3/vault/payment-tokens` 201, customer id returned.
- Charge with `payment_source.paypal.vault_id`, no buyer present, USD 10.00 -> 201 COMPLETED, capture COMPLETED. **Automatic payment (F13) works.**
- `DELETE /v3/vault/payment-tokens/{id}` -> 204. Charge immediately after -> **403 NOT_AUTHORIZED PERMISSION_DENIED**; again 5 s later -> same 403. **Kill switch (F15) is enforced by PayPal, effective immediately** (no async window seen).

## Still to test
- [ ] Business account as payer (Treasury business as the approving payer); fallback is the Personal payer
- [ ] Webhooks (needs Render URL)
- [ ] Log in with PayPal userinfo paths, multiple Return URLs
- [ ] Payouts to PayPal and Venmo (Jose)

## Gate 1 and Gate 2 progress (2026-10-28 and 2026-10-29)
- Vault, automatic payment, supervised approval and kill switch re-run through our own code (executor and routes): 9 of 9 checks passed on the sandbox (Oct 28).
- Webhook: a simulator event `PAYMENT.CAPTURE.COMPLETED` v2.0 to the Treasury URL was verified and answered 200 on staging (Oct 29). Real events signed with the actual webhook id are not seen yet.
- `GET /v1/reporting/balances` on the Treasury app: 200, USD 5,211.57; `as_of_time` is the end of the previous reporting window; a currency with no balance returns no `balances` key.
- Log in with PayPal: the APIMatic plugin does not cover Identity. Not yet tried against a real login.
