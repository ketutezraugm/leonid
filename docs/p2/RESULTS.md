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

## Gate 2 rehearsal with the real rules (2026-11-02, staging at 8e55b7e)
Run with `pnpm --filter @quartermaster/api gate2:check`, then `-- --finish <approvalId>`, against staging with the seeded event.
- $140 swag from the approved vendor: allowed ("within the rules and the unlocked budget"), auto-paid, capture 22G915942B0287409.
- $420 prize cart: needs approval ("over the 200.00 USD approval threshold"), charged nothing, PayPal order PAYER_ACTION_REQUIRED. After the treasurer approved at PayPal the order read APPROVED; capture 74724507DE504441U; the approval is paid.
- Kill switch: revoke 200; a spend afterwards refused with 409 no_wallet; `GET /v3/vault/payment-tokens/{id}` answers 404 TOKEN_NOT_FOUND.
- Audit: `spend.check` rows for both spends with the decision, outcome and PayPal id, event id on each.
- Quirk repeated: the PayPal checkout page reloads after approving a manually opened link, though the order is approved.
- Not covered: the screens (Approvals button, Settings, revoke) against real PayPal; production.

## Screens against real PayPal (2026-11-02, staging at 8e55b7e, run by Ezra)
With the merged frontend (landing page, event shell), logged in with PayPal as the allowlisted sandbox Personal account in a normal browser window.
- Settings, Connect wallet: approved at PayPal, returned signed in, wallet active.
- A $420 spend was created with the demo route; Approvals showed it with the rule reason. Approve with PayPal opened the popup; after approving, the item turned paid with no reload of the PayPal page. Capture 4VU28739WM5938909; the audit actor is the logged-in treasurer (treasurer:paypal:<PayPal user id>), so the browser path ran, not the ops token or the webhook.
- Settings, Revoke agent wallet: wallet revoked; a spend afterwards refused (409 no_wallet); PayPal answers 404 TOKEN_NOT_FOUND for the deleted token.
- Found: the sidebar's Approvals count stays at 1 after the payment until the page is reloaded. The shell data has refreshApprovals(), but ApprovalDetail calls it only from its Done and Refresh buttons, not after a successful capture or decline. Reported to P4.
