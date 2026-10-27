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
