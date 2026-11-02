# P2 progress (Ezra): PayPal buy side and infra

Status as of Mon Nov 2, 2026. Written for the team (Harfi, Jose, Abel) and their coding agents. No secrets in this file. Plan: [PLAN.md](PLAN.md). Sandbox test results: [RESULTS.md](RESULTS.md). How to rerun the rehearsal: [GATE2-REHEARSAL.md](GATE2-REHEARSAL.md).

## Where we are

- **Gate 1 is done** (Oct 29): staging verified a real PayPal webhook event.
- **Gate 2 (Tue Nov 3), API side, is proven on staging** (https://quartermaster-staging.onrender.com, branch `development` at `8e55b7e`) with Harfi's real `check()`: login, wallet connect, $140 auto-pay, $420 approval and capture, kill switch. Evidence below.
- **Not yet proven:** the screens against real PayPal (Abel's session), and a production service from `main`.

## Gate 2 evidence (staging, Nov 2)

| Beat | Result |
| --- | --- |
| F1 Log in with PayPal | `?login=ok`, session works (Oct 29). userinfo path `/v1/identity/openidconnect/userinfo?schema=openid` verified |
| F2 treasury | `GET /api/treasury` returns balances with an as-of time; shown in Settings |
| F13 wallet | Connected as a sandbox Personal payer; $140 auto-paid with the saved wallet (capture `22G915942B0287409`). Decision from the real rules: "within the rules and the unlocked budget" |
| F14 approval | $420 opened an approval and charged nothing ("over the 200.00 USD approval threshold"). Approved at PayPal, captured through the API (capture `74724507DE504441U`), approval marked paid |
| F15 kill switch | Revoke returned 200; a spend afterwards was refused (409 `no_wallet`); PayPal answers `404 TOKEN_NOT_FOUND` for the deleted token |
| Audit | `spend.check` rows with decision and outcome for each beat, and the PayPal ids, readable at `GET /api/spends/recent` |
| Seed | Re-run on staging: pledges $3,000 / $2,500 / $2,500 |
| Funds gate | Harbor Cloud's $3,000 invoice was paid (INVOICING.INVOICE.PAID webhook, one ledger row), which is what lets the real check allow spends |

**Say this plainly in the report:** the rules are a hard-coded list (`rules/demoRules.ts`) until the rules compiler (F8) and the rules table land. "Rules confirmed by the treasurer" is not done. The screens are not yet proven against real PayPal, and there is no production service yet.

## Merged since the last update

Every P2 PR is merged: webhook delivery log, DB-backed wallet/approvals/audit, F1 login, F2 treasury, the `CHECKOUT.ORDER.APPROVED` backup capture, shared session/wallet/approval types, the demo spend route and `gate2:check`, a 30 s timeout on PayPal calls with an optional `eventId` on `Spend`, `GET /api/spends/recent`, revoking the Supabase API roles' grants (applied to staging by hand), and wiring the real rules check into the payments context.

## What is left

1. **Abel's session** against real PayPal: connect the wallet, Approve with PayPal (the SDK button with our orders), revoke in Settings.
2. **Production:** a paid Render service from `main`, billing alert at $35, its own webhooks and Log in with PayPal return URL. Open question for Harfi: its own Supabase database, or shared?
3. **After the gate (P2):** write `failed`, not `error`, when PayPal definitely refuses (4xx except 408/409, never "order already captured"); `event_id` on approvals and spend references, with capture, decline and spend refusing without an event, and the event id in each PayPal order's `custom_id`; a rate limit on the demo login; a reset for the shared judges' demo (needs a token pool and a decision on the budget: each run uses about $560 of the $3,000).
4. **Turn `DEMO_SPEND` off** on Render after the rehearsal.

## Things to know

- PayPal's reporting balance lags; Settings shows it with an as-of time. The funds-gated budget uses ledger income, not this number.
- The checkout page for a manually opened approval link keeps reloading after you approve, though the order is approved. PayPal's SDK button (the Approvals page) does not use that page.
- The staging database has no Drizzle migrations table: new migrations are applied by hand there.
- The real check blocks every spend that names no event and every spend while no sponsor money has cleared.
- Render can briefly run old and new code together during a deploy: no spends until the new deploy is Live and the old one is deactivated.
- The APIMatic Context Plugin has no coverage of PayPal Identity, so F1 is not attributed to it; see the README APIMatic section for what was queried.
