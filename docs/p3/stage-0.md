# P3 Stage 0: day-1 tests, AG Studio, shared contract, APIMatic

Owner: P3. Source: PRD §14 (day-1 tests) and §11 (roles). Gate: Oct 28, "every day-1 test answered".

## What is in the repo

| Item | Where | State |
| --- | --- | --- |
| Shared zod contract: Sponsor, Invoice (+ draft, reminder draft), LedgerEntry, PayoutItem/Batch, Claim (+ receipt extraction), 4 widget payloads + payouts ledger, `WidgetFilter` | `packages/shared/src/*.ts` | Done, 22 tests |
| Day-1 scripts: Invoicing, Payouts, Transaction Search | `apps/api/scripts/day1/` | Written and unit-tested against a fake PayPal (27 tests). Run against the sandbox on 2026-10-27: Transaction Search passed, Invoicing create+send passed, PayPal payouts passed. Still open: paying the invoice and the two webhook events |
| AG Studio in the Vite app: theme from tokens, data sources from the shared shapes, default report, lazy-loaded | `apps/web/src/money/`, `apps/web/src/pages/Money.tsx` | Renders in a browser with sample data, see `docs/p3/screenshots/money-stage-0.png` |
| APIMatic Context Plugin | `claude plugin list` | Installed (user scope). Not yet used: needs `/reload-plugins`. Log: `docs/apimatic-log.md` |

## What only you can do

### 1. Sandbox accounts and the Treasury app (developer.paypal.com > Apps & Credentials > Sandbox)

1. Sandbox accounts: a **Business** account (the event treasury), a **Personal** account that pays invoices, and a **Personal** account that receives payouts.
2. A REST app on the Business account named like `leonid-treasury`. Enable the features it lists that we use: **Transaction Search** (required for the search test), **Payouts**, and **Invoicing** if it is listed. P2 owns the second app (Procurement).
3. Put the keys in `.env` (copy `.env.example`): `PAYPAL_TREASURY_CLIENT_ID`, `PAYPAL_TREASURY_CLIENT_SECRET`, `DAY1_SPONSOR_EMAIL` (the paying Personal account), and `DAY1_PAYPAL_RECIPIENT_EMAIL`.

### 2. Register a webhook for the Treasury app

PayPal only generates an event for subscribed types, so without this the "webhook arrives" half of the invoicing test cannot pass. Subscribe to `INVOICING.INVOICE.PAID`, `PAYMENT.PAYOUTSBATCH.SUCCESS` and `BILLING.SUBSCRIPTION.ACTIVATED`. The URL is P2's receiver on Render once it is live; until then use a tunnel to the local API. The scripts list your webhooks first and warn if none is subscribed.

### 3. Run the three tests (from the repo root)

```sh
pnpm --filter @leonid/api day1:search
pnpm --filter @leonid/api day1:invoicing     # prints a pay link; open it in a private window as the Personal sponsor account
pnpm --filter @leonid/api day1:payouts
```

Flags: `day1:invoicing --invoice-id INV2-... | --no-wait | --amount-cents 100 | --wait-minutes 10`, `day1:payouts --batch-id <stable id> | --wait-minutes 3`, `day1:search --days 7`. Each ends with `RESULT <step> PASS|FAIL|WARN|SKIP <detail>` lines and a non-zero exit code on FAIL. Paste those lines into the table below.

| Result | Meaning | Fallback (PRD §14) |
| --- | --- | --- |
| `invoicing.paid` PASS and `invoicing.webhook-event` PASS | F4 can be webhook-driven | none needed |
| `invoicing.webhook-event` FAIL | Invoice paid but PayPal fired no event | Poll the invoice, or an Orders checkout link for sponsors |
| `invoicing.create`/`send` FAIL | Invoicing not usable on this app | Orders checkout link for sponsors |
| `search.query` FAIL with 403 | Transaction Search not enabled on the app | Enable it in the app's features |
| `search.data` WARN (0 rows) | Valid on a fresh sandbox; results lag up to ~3 hours | Re-run after the other two tests |

Notes on the scripts:

- They hard-code `https://api-m.sandbox.paypal.com` and cannot reach live PayPal.
- The payout script creates a sandbox payout **outside the rules engine**, because PRD §14 asks for this test and the engine does not exist yet. Production payouts go only through P1's executor.
- Payouts are PayPal-only. The sandbox does not support `PHONE` recipients, so use the recipient's PayPal email.
- Endpoint shapes were taken from PayPal's published OpenAPI specs (`developer.paypal.com/api/<name>/schema.json`), not from the APIMatic plugin. See `docs/apimatic-log.md`.

### Day-1 results (fill in)

| Test | Date | Result lines | Decision |
| --- | --- | --- | --- |
| Invoicing | 2026-10-27 | `invoicing.create PASS` (INV2-KUAD-G3SZ-RL4H-P6QK), `invoicing.send PASS` (HTTP 200), `invoicing.state PASS` (SENT). **Payment and `INVOICING.INVOICE.PAID` not yet checked**: waiting for the invoice to be paid and for P2's webhook | Create and send work. Re-run with `--invoice-id INV2-KUAD-G3SZ-RL4H-P6QK` after paying |
| Payouts | 2026-10-27 | `payouts.create PASS` (batch VBTQYXLLQSYU2, PayPal recipient), item `SUCCESS`, `payouts.batch PASS` (SUCCESS), `payouts.webhook-event WARN` (no webhook subscribed) | PayPal payouts work |
| Transaction Search | 2026-10-27 | `search.query PASS` (HTTP 200, 0 rows in 14 days, last refreshed 2026-10-27T13:29:59Z), `search.data WARN` (fresh sandbox) | Works: use it for reconciliation and reports. Re-run after the other tests |

### 4. AG Studio trial licence

Without a key, Studio runs in trial mode: all features work, a watermark shows and the console prints "License Key Not Found" (this is what the screenshot shows). To remove the watermark, email info@ag-grid.com for a trial key, then set `VITE_AG_STUDIO_LICENSE` in `.env`. Do not commit a real key until the sponsor confirms a public key is fine.

Draft for the hackathon Discord (AG Grid channel):

> Hi AG Grid team! We're building Quartermaster for the PayPal AI Hackathon with an AG Studio command center. Two questions: (1) Our repo is public (MIT). Is it OK to commit our trial licence key, or should we keep it in an env var and only set it on our hosted demo? (2) Our trial runs about 45 days from Oct 27, which is around Dec 11. Will it stay valid through judging, or should we request an extension? Thanks!

### 5. APIMatic

Run `/reload-plugins`, then `/onboard-context-matic`, then the prompts in `docs/apimatic-log.md` and record the results there as you go.

## Contract decisions to review in the PR

- **camelCase** in our own API shapes. PayPal's snake_case stays at the PayPal client boundary.
- **Sponsor `tier` is a free string**, because the PRD does not name the tiers. P4's seed defines them.
- **`RuleDecision` and `RuleResult` live in `common.ts`** with the shape from `money-safety.md`. P1 owns them: move or extend as needed.
- **`LedgerSource` is a first guess** (sponsor_invoice, subscription, ticket, donation, purchase, refund, claim_payout, speaker_payout, prize_payout) and `LedgerEntry.category` is added so Budget burn can group by category. P1 and P2 should confirm.
- **`PayoutDestination` is PayPal-only**: an email or a PayPal ID. Handle-style recipients and `PHONE` (unsupported in the sandbox) are rejected.
- Money is integer minor units plus an ISO code everywhere. The only place cents become dollars is `studio-data.ts`, because Studio's currency format wants dollars.

## Things to raise at standup

1. **Who owns the database setup?** Nobody does in the PRD, and the ledger, payouts and claims tables depend on it.
2. **P2:** webhook handlers as one file per event (`webhooks/handlers/<event>.ts`) in a registry, plus the Render URL for the webhook. P3 writes `INVOICING.INVOICE.PAID`, `PAYMENT.PAYOUTSBATCH.SUCCESS` and `BILLING.SUBSCRIPTION.ACTIVATED`.
3. **P1:** the payout request shape that `check()` needs (kind, person, date, category, amount in cents) and the `audit()` signature.
4. **P4:** sponsor tiers for the seed, and the sponsor "paid" status or event that releases the gated Gantt task.

## Known issues

- Web tests need **Node 22.19 or newer**: `.nvmrc` says `22`, but jsdom 30 pulls `undici@8`, which refuses 22.14. On older Node, `pnpm test` fails to start the web workers (not a code bug). Upgrade with `nvm install 22`.
- AG Studio chunk is about 5.3 MB (1.5 MB gzipped), loaded only on the Money page.

## Stage 2 polish noted from the first render

**Done in Stage 2** (see [`stage-2.md`](stage-2.md)): the `$` symbol, the filter relations on sponsor and category, and the Rules health and Delivery risk widgets. Chart colours now come from the tokens through the custom widgets; Studio's own chart palette is left as it is. The list below is kept as it was written.

- Money values show no currency symbol (`3,000.00`): switch the money fields to a USD format.
- Charts use Studio's default palette, not our tokens: add a chart palette to the tokens and the theme.
- No cross-filtering yet ("No filters available"): define relations on `sponsorId` and `category`, and add filter widgets.
- The Payouts ledger, Rules health and Delivery risk custom widgets: only the ledger grid is on the page so far.
