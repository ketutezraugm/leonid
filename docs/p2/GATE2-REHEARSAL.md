# Gate 2 rehearsal (P2)

Tue Nov 3. Written for the team and their coding agents. No secrets in this file. Status of each piece: [PROGRESS.md](PROGRESS.md).

**Gate 2 says:** F1, F2, F13, F14 and F15 work on Render with Harfi's `check()`; the seed runs; a $140 spend auto-pays, a $420 spend opens an approval, and after the kill switch PayPal refuses the charge.

## Before the rehearsal

- [ ] `development` has the P2 PRs (login refusal log, `POST /api/demo/spend`, shared session and wallet types) and Abel's web build. Harfi merges them.
- [ ] Harfi's `check()` is wired into `apps/api/src/payments/context.ts` in place of `stubCheck`. If it has not landed, say so in the report: the rehearsal then runs on the stand-in rule ("nothing over $200 without approval") and Gate 2 is only partly met.
- [ ] Render (`quartermaster-staging`, branch `development`) has `DEMO_SPEND=true`. Set it back to `false` afterwards.
- [ ] The Procurement webhook is subscribed to `CHECKOUT.ORDER.APPROVED`; the Treasury webhook to `INVOICING.INVOICE.PAID`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED`.
- [ ] The agent wallet is active. If not: `pnpm --filter @quartermaster/api gate2:check -- --connect`, open the link, log in as the sandbox **Personal** payer and agree. It returns to `/?wallet=connected`.
- [ ] Your gitignored `.env` has `STAGING_TREASURER_TOKEN`. For the stronger checks it also has `STAGING_DATABASE_URL` (the Supabase Transaction pooler string) and the Procurement credentials.

## The API beats (about 5 minutes)

1. `pnpm --filter @quartermaster/api gate2:check`
   - Expect: server up, token accepted, demo route enabled, wallet active, **$140 auto-paid**, **$420 opened an approval and charged nothing**, and the audit rows (`paid`, `needs_approval`) when the database URL is set.
   - It prints a PayPal link and the next command.
2. Open the link in a private window, log in as the sandbox **Personal** payer, and approve the $420 order. The page may keep reloading afterwards; PayPal still records the approval.
3. `pnpm --filter @quartermaster/api gate2:check -- --finish <approvalId>`
   - Expect: order approved at PayPal, **$420 captured**, approval marked paid, then the kill switch: wallet revoked, **a spend after it refused (409 `no_wallet`)**, and PayPal no longer has the payment token (404).
   - If the `CHECKOUT.ORDER.APPROVED` webhook captured first, the script says so and still passes.
   - `--keep-wallet` skips the kill switch.
4. Reconnect for the next run: `gate2:check -- --connect`.

## The UI beats (needs Abel's build deployed)

- [ ] Sign in with PayPal (an allowlisted account) lands signed in; a non-allowlisted account shows the "not allowed" state; "Enter demo as treasurer" works where `DEMO_LOGIN` is on.
- [ ] Settings shows the wallet (`Active`, the payer's email) and the Treasury balance **with "as of"**.
- [ ] Create a $420 spend (`gate2:check` step 1). Approvals shows it with the rule reason and the agent's reasoning. **Approve with PayPal** opens PayPal's popup; after approving, the item shows paid. Test this with the real button: it is the one piece not yet proven with our orders.
- [ ] Settings, Revoke agent wallet: confirm dialog, status turns Revoked everywhere, and a new spend is refused.

## What counts as passing

| Beat | Pass when |
| --- | --- |
| F1 | Login ends in `?login=ok` and `/api/auth/me` shows the account |
| F2 | `GET /api/treasury` returns balances with an as-of time (and Settings shows it) |
| F13 | The wallet connects, and $140 returns `paid` with a capture id |
| F14 | $420 returns `needs_approval`, PayPal approves, capture returns `paid` |
| F15 | Revoke returns `revoked`; the next spend is refused; PayPal answers 404 for the token |
| Audit | Every beat has an `audit_log` row (`spend.check`, `spend.capture`, `wallet.revoke`) |

## Cleanup

1. `DEMO_SPEND=false` on Render (and `DEMO_LOGIN` as agreed for the judges' demo).
2. Reconnect the wallet if the next person needs it.
3. The $140 and $420 are sandbox money out of the personal payer; nothing real moves.

## Known quirks

- A free Render instance sleeps; the first request can take a minute. The script waits up to two minutes per call.
- PayPal's checkout page can loop on "Complete purchase" after you approve a manually opened order link. The order is still `APPROVED`. The Approvals page uses PayPal's button and popup, which should not loop; confirm it.
- The staging database has no Drizzle migration table, so new migrations are applied by hand there.
- If a call returns 401, the treasurer token is wrong. If it returns 500 or 503, check that Render's `DATABASE_URL` is the Supabase Transaction pooler string.

## Production (after Harfi promotes `development` to `main`)

- [ ] Production service exists on the paid plan with the billing alert at $35 and its own webhook ids and Log in with PayPal return URL.
- [ ] `/api/health` is 200, a PayPal login works, and `gate2:check` passes with `GATE2_BASE_URL` pointing at it (the script needs `TREASURER_TOKEN` set on that deployment).
