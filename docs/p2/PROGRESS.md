# P2 progress (Ezra): PayPal buy side and infra

Status as of Thu Nov 5, 2026 (Gate 3 evidence is in its own section below; the Gate 2 sections are as of Nov 2). Written for the team (Harfi, Jose, Abel) and their coding agents. No secrets in this file. Plan: [PLAN.md](PLAN.md). Sandbox test results: [RESULTS.md](RESULTS.md). How to rerun the rehearsal: [GATE2-REHEARSAL.md](GATE2-REHEARSAL.md).

## Where we are

- **Gate 1 is done** (Oct 29): staging verified a real PayPal webhook event.
- **Gate 2 (Tue Nov 3), API side, is proven on staging** (https://quartermaster-staging.onrender.com, branch `development` at `8e55b7e`) with Harfi's real `check()`: login, wallet connect, $140 auto-pay, $420 approval and capture, kill switch. Evidence below.
- **The screens are proven against real PayPal too** (Nov 2, run by Ezra on staging with the merged frontend): connect the wallet, Approve with PayPal, revoke. Evidence below.
- **Gate 3 (Sat Nov 7), P2 side, is proven on staging as of Nov 5:** public tickets and donations (F6), three Render Workflows (budget recompute, invoice reminders, sponsor reports), the demo wallet pool with a treasurer-triggered reset, and a rate-limit fix for the judges' demo. Evidence in "Gate 3 evidence" below. All PRs are merged into `development`; none are open.
- **Not yet:** a production service from `main` (`main` is about 200 commits behind `development`; promoting it needs Ezra's word), the other two Workflows (delivery check: no tracking data exists yet; payout batch: waits on the claims code), and payouts end to end (waits on the claims code, F16).

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
| Screens: connect wallet | Settings, Connect wallet, approved at PayPal, back signed in with the wallet active |
| Screens: Approve with PayPal | The SDK button with our orders worked: the $420 item turned paid; capture `4VU28739WM5938909`, audit actor `treasurer:paypal:<PayPal user id>` (a real login, not the ops token) |
| Screens: revoke | Settings, Revoke agent wallet; a spend afterwards was refused (409 `no_wallet`); PayPal answers `404 TOKEN_NOT_FOUND` for the token |
| Funds gate | Harbor Cloud's $3,000 invoice was paid (INVOICING.INVOICE.PAID webhook, one ledger row), which is what lets the real check allow spends |

**Say this plainly in the report:** the rules are a hard-coded list (`rules/demoRules.ts`) until the rules compiler (F8) and the rules table land. "Rules confirmed by the treasurer" is not done. There is no production service yet, and one screen detail is open: the sidebar's Approvals count stays until the page is reloaded after a payment (P4).

## Gate 3 evidence (staging, Nov 5, real PayPal sandbox)

| What | Evidence |
| --- | --- |
| F6 ticket | A $25 ticket reached the ledger through the `PAYMENT.CAPTURE.COMPLETED` webhook, tagged ticket for the demo event, net $23.85 (the ledger is net of PayPal's fees) |
| F6 donation | A $10 donation reached the ledger the same way (source `donation`, net $9.36); the demo event's cleared total went from $3,023.85 to $3,033.21 |
| Workflow: budget recompute | Run `trn-0b94gdbm1qiielr1g00etaclg` recomputed 5 events in parallel; audit has 5 `workflow.budget_recompute` rows and 1 `workflow.trigger` |
| Workflow: invoice reminders | A sandbox invoice for the bronze sponsor ($2,500, PayPal invoice `INV2-74AX-9CRJ-YW3Y-GLN6`) was sent; run `trn-0b94gdbm2ic1avh9s73fm7oqg` succeeded with outcome `reminded`; audit has `invoice.create`, `invoice.sent`, `workflow.trigger`, `invoice.reminder` for the same invoice. A sponsor is reminded at most once per 24 h, and PayPal's live status decides (a sponsor who just paid is skipped) |
| Render Dashboard | [screenshots/render-workflows.png](screenshots/render-workflows.png): the Workflow service on `development` with all four tasks (`budget-recompute`, `recompute-event`, `invoice-reminders`, `remind-sponsor`) at 100% success. The creator's email is blacked out |
| Demo wallet pool | Three approval links (created with `permit_multiple_payment_tokens`) were approved as the Personal sandbox account and became three standby tokens. `POST /api/wallet/pool/reset` activated the first; a second reset ran the kill switch on it (PayPal then answered 404 for that token), activated the next, and the last standby token still existed at PayPal. Audit: `wallet.revoke`, `wallet.pool_reset`. Standby tokens are never charged. Migration 0009 (`demo_token_pool`) was applied to staging by hand |
| Rate limits behind Render | A temporary probe showed three proxy layers in front of the API, so `trust proxy` 1 made every visitor share one rate-limit address (Render's internal proxy). Fixed with 3 hops (`TRUSTED_PROXY_HOPS`) and verified: with a spoofed `X-Forwarded-For` the app saw the caller's own address. The probe is removed |
| Webhook verification | The certificate fetch now times out after 10 s; the router answers 503 and PayPal retries |
| Workflow: sponsor reports | Run `trn-0b94gdbm9241avh9s73fm7pj0` published Harbor Cloud's report (4 purchases, AI summary); `/report/<link>` rendered it with each purchase's PayPal ID, and the public route answers `no-store`, `noindex`, `no-referrer`. Checked by hand: $3,000.00 is 98.9% of the $3,033.21 cleared income, and 98.9% of the $1,400.00 spent is $1,384.67. Migration 0010 (`sponsor_reports`) was applied to staging by hand. |
| Sponsor report vs PayPal's records | Each purchase is checked against Transaction Search (`paypal/search.ts`): confirmed only for a successful payment of exactly that amount with nothing refunded against it; "not in PayPal's records yet" is not an accusation (the search lags about 3 h). First live run (`trn-0b94gdbm9qgmrc87g00ef2lmg`): 1 of 4 confirmed, because three approved purchases were stored by order id while PayPal lists the capture id (all three capture ids were already on the executor's `spend.capture` audit rows and are in PayPal's search). Fixed to show and check the capture id; rerun `trn-0b94gdbmmueg1muic73fgptug`: **4 confirmed, 0 differ, 0 not found**, same share link, same $1,384.67 total. A refund or reversal listed against a purchase would make it "differs", never "confirmed" (covered by tests; none occurred on staging) |

**Say this plainly in the report:** the pool's standby tokens are the one place a token exists that the active wallet's kill switch does not delete. `POST /api/wallet/pool/end` deletes them all, and it has not been run live yet. Payout code (executor path, Payouts wrapper, wiring) is merged and unit-tested but has not moved sandbox money, because nothing calls it until the claims code (F16) lands.

## Merged since the last update

Every P2 PR is merged: webhook delivery log, DB-backed wallet/approvals/audit, F1 login, F2 treasury, the `CHECKOUT.ORDER.APPROVED` backup capture, shared session/wallet/approval types, the demo spend route and `gate2:check`, a 30 s timeout on PayPal calls with an optional `eventId` on `Spend`, `GET /api/spends/recent`, revoking the Supabase API roles' grants (applied to staging by hand), and wiring the real rules check into the payments context.

## What is left

1. **P4:** the sidebar's Approvals count should drop as soon as a payment or decline succeeds, not only after a reload. In `ApprovalDetail.tsx`, call the shell's `refreshApprovals()` (from `useShellData`) after a successful capture and after a decline, without clearing the selection, so the paid confirmation stays visible.
2. **Production:** a paid Render service from `main`, billing alert at $35, its own webhooks and Log in with PayPal return URL. Open question for Harfi: its own Supabase database, or shared?
3. **After the gate (P2):** write `failed`, not `error`, when PayPal definitely refuses (4xx except 408/409, never "order already captured"); `event_id` on approvals and spend references, with capture, decline and spend refusing without an event, and the event id in each PayPal order's `custom_id`; a rate limit on the demo login; a reset for the shared judges' demo (needs a token pool and a decision on the budget: each run uses about $560 of the $3,000).
   *Update Nov 5:* the demo-login rate limit, `event_id` on approvals and spends, and the wallet side of the shared-demo reset (the token pool) are done. The budget side of that reset (topping the budget up with real sandbox donations through the product, never by editing the ledger or audit rows) is not.
4. **`DEMO_SPEND` is still ON on staging** (Nov 5; teammates are testing). Turn it off before the judges' run (Nov 8-9).
5. **Waiting on teammates:** Jose, the claims code (F16) calling the payout executor and the final list of payout webhook events (Ezra then subscribes the Treasury webhook to them in the PayPal dashboard). Abel, the payout approvals screen and a Reset-demo button for the pool.

## Things to know

- **Staging demo state (Nov 5):** the bronze sponsor (Pixel Foundry) is `invoiced`, silver (Lumen Labs) is `pledged`, gold (Harbor Cloud) is `paid`. The agent wallet is active (a pool token) and the pool has one standby token left; refill it with `POST /api/wallet/pool/fill` and approve the links in a normal browser window as the Personal sandbox account.
- Staging migrations 0007, 0008 and 0009 were applied by hand; the next migration number is 0010.

- PayPal's reporting balance lags; Settings shows it with an as-of time. The funds-gated budget uses ledger income, not this number.
- The checkout page for a manually opened approval link keeps reloading after you approve, though the order is approved. PayPal's SDK button (the Approvals page) does not use that page.
- The staging database has no Drizzle migrations table: new migrations are applied by hand there.
- **Log in with PayPal cannot run on a laptop.** PayPal's dashboard refuses to save `http://localhost:5173/...` (and `https://localhost`) as the Treasury app's return URL, so locally use `DEMO_LOGIN=true` and "Enter demo as treasurer", and test the real PayPal login on staging. A separate local sandbox app would be refused the same way.
- The real check blocks every spend that names no event and every spend while no sponsor money has cleared.
- Render can briefly run old and new code together during a deploy: no spends until the new deploy is Live and the old one is deactivated.
- The APIMatic Context Plugin has no coverage of PayPal Identity, so F1 is not attributed to it; see the README APIMatic section for what was queried.
