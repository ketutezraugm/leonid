# P2 progress (Ezra): PayPal buy side and infra

Status as of Thu Oct 29, 2026. Written for the team (Harfi, Jose, Abel) and their coding agents. No secrets in this file. Plan: [PLAN.md](PLAN.md). Sandbox test results: [RESULTS.md](RESULTS.md).

## Where we are

- **Gate 1 is done.** The webhook listener on staging verified a real PayPal simulator event (`PAYMENT.CAPTURE.COMPLETED`) against PayPal and answered 200. Staging runs from `development` at https://quartermaster-staging.onrender.com.
- **Gate 2 (Tue Nov 3):** the P2 backend is written and in open PRs. What blocks Gate 2 now is review/merge, Harfi's `check()`, something that calls `requestSpend`, and the web pieces.

## Open PRs (all target `development`, all waiting for Harfi to review and merge)

| PR | Branch | What | Notes |
| --- | --- | --- | --- |
| #14 | `p2/webhook-recent` | `GET /api/webhooks/paypal/recent`, a delivery log for the treasurer | lets us see real webhook deliveries on staging |
| #15 | `p2/db-adapters` | wallet, approvals, audit rows and spend reference ids stored in the database | **run migration 0003 on Supabase first**; adds `outcome`/`detail` to `audit_log` |
| #16 | `p2/f1-login` | F1 Log in with PayPal for the treasurer, signed-cookie sessions, `TREASURER_ALLOWLIST` | not yet tried against real PayPal |
| #17 | `p2/apimatic-readme` | README APIMatic log | docs only |
| #18 | `p2/f2-treasury` | F2 `GET /api/treasury` balances | adds `TreasuryResponse` to `packages/shared` |
| #19 | `p2/order-approved` | `CHECKOUT.ORDER.APPROVED` backup capture | **stacked on #15, merge #15 first** |

Merge order suggested: #14, #15, #16, #17, #18, #19.

## Done and proven live on the sandbox

- Vault wallet connect, automatic payment of $10 (F13), a spend over $200 turned into a PayPal order approved in the popup and then captured (F14), kill switch deleting the token and PayPal refusing the next charge with 403 (F15). Nine of nine checks passed on Oct 28.
- Webhook signature check against real PayPal (simulator event, Gate 1).
- `GET /v1/reporting/balances` through the new route: 401 without the treasurer token, 200 with it, response matches the shared schema. The Treasury balance was USD 5,211.57 on Oct 29.

## What is left for P2 (Gate 2)

1. First real "Log in with PayPal" on staging after #16 merges. Two things are unverified: the userinfo path (`/v1/identity/openidconnect/userinfo?schema=openid`, fallback `/v1/identity/oauth2/userinfo?schema=paypalv1.1`) and whether the sandbox returns `user_id` and `email_verified`.
2. Web: login and demo-login buttons, wallet card with balance, "as of", connect and kill-switch on Event home, and the Approvals page with the PayPal SDK v6 button. Files to agree with Abel first.
3. Shared contract PR for session, wallet and approvals responses (only the treasury response exists, in #18).
4. Wire Harfi's real `check()` in place of `stubCheck` (adapter in `apps/api/src/payments/context.ts`).
5. Paid production Render service from `main`, billing alert at $35.
6. Rehearsal on `development` with Harfi on Tue Nov 3: $140 auto-pays, $420 opens an approval, kill switch makes PayPal refuse.

## What P2 needs from others

- **Harfi:** merge the PRs above; run migration 0003 on Supabase before #15 deploys; land `check()` in `apps/api/src/rules/` returning `{ decision, reasons, ruleIds }`, currency-aware and with a per-day cap; provide the procurement agent tool that calls `executor.requestSpend` with a stable `referenceId` per cart. **Today nothing outside the tests calls `requestSpend`, so the $140 and $420 beats cannot run on staging.** If the tool is late, P2 adds a small treasurer-only demo route behind a flag that is off by default. Promote `development` to `main` after the rehearsal.
- **Jose:** register handlers for `INVOICING.INVOICE.PAID` (only when fully paid) and `PAYMENT.CAPTURE.COMPLETED` that write the ledger, with `registerHandler(...)` from `apps/api/src/webhooks/registry.ts`, and add `INVOICING.INVOICE.PAID` to the Treasury webhook in the PayPal dashboard. Unlocked budget counts only ledger income.
- **Abel:** which files in `apps/web` P2 may edit (`EventHome.tsx`, `Approvals.tsx`, new folders `src/approvals/` and `src/wallet/`), and the design tokens to use for the wallet card.

## Things to know

- PayPal's reporting balance lags (it shows when it was last refreshed). Display it with "as of"; the funds-gated budget uses webhook-confirmed ledger income, not this number.
- If the webhook backup in #19 captures an approved order first, the browser's `POST /api/approvals/:id/capture` answers 409 although the money moved. The Approvals page should treat "already paid" as success.
- The APIMatic Context Plugin has no coverage of PayPal Identity, so F1 is not attributed to it. See the README APIMatic section (#17) for what was queried and what the plugin answered.
- Env vars added for F1: `SESSION_SECRET` (32+ characters), `TREASURER_ALLOWLIST`, `DEMO_LOGIN`. Names are in `.env.example`; values are set in the Render dashboard, never in git.
