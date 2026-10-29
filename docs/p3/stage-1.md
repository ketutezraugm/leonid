# P3 Stage 1: F4 sponsor invoices

Owner: P3. Source: PRD §7 (treasury agent), §14 (day-1 tests) and the Stage 1 plan. Reader: the team (P1, P2, P4) and P3.

**Status: the code is merged into `development` (PRs #20, #21 and #22), and the current invoice shape was verified in the sandbox on 2026-10-29, but Stage 1 is not complete until the end-to-end check at the bottom has been run on staging.** Items that are not done are marked as such throughout.

The Stage 1 goal was: an invoice arrives in the sponsor's sandbox account, and paying it raises the unlocked budget.

| Half of the goal | State |
| --- | --- |
| An invoice arrives in the sponsor's sandbox account | Shown. The earlier code sent a real invoice, and on 2026-10-29 PayPal accepted the current code's invoice shape (`due_date` only, `detail.reference`) and found it by reference (see the evidence section). A send with the current code happens in the end-to-end check. |
| Paying it raises the unlocked budget | **Not shown yet.** The code that writes the income is merged and tested, but it needs staging deployed and P1's budget function, which does not exist yet. |

## How a sponsor invoice flows

```
organizer: "invoice Harbor Cloud"
   -> treasury agent drafts (the pledge, one line, due in 14 days). It cannot send.
   -> treasurer reviews the draft and types the sponsor's email
   -> POST /api/sponsors/:id/send  (treasurer token)
        records the attempt, creates the PayPal invoice (reference = sponsor id),
        saves paypal_invoice_id, sends it, sponsor 'pledged' -> 'invoiced'
   -> sponsor pays on PayPal
   -> PayPal fires INVOICING.INVOICE.PAID -> POST /api/webhooks/paypal/treasury
        handler: fully paid? -> one ledger row (cleared income) + sponsor -> 'paid'
   -> P1's budget: unlocked = cleared income - committed spend     (not built yet)
   -> P4's Gantt: tasks funded by that sponsor are released        (P4)
```

## What was built

Three branches, three pull requests, all merged into `development` after review fixes.

| PR | Branch | What it adds |
| --- | --- | --- |
| #20 | `p3/ledger-income-handlers` | `ledger_entries` table (migration `0005_ledger_entries`), ledger helpers, and the `INVOICING.INVOICE.PAID`, `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` / `REVERSED` webhook handlers |
| #21 | `p3/f4-invoice-flow` | Invoicing v2 client (create, send, get, search by reference), the draft builder, the send service and the treasurer-only routes |
| #22 | `p3/f4-treasury-agent` | The treasury subagent and the orchestrator's `delegate_to_treasury` tool |

The branches did not all merge cleanly. The ledger migration was first numbered `0003` and conflicted with P2's `0003` from `p2/db-adapters` (#15, merged first), so it was regenerated as `0005_ledger_entries`. `development` now has migrations `0000` to `0005` in one journal. #21 and #22 were brought up to date with `development` before they landed. The API suite passes on the merged code (`pnpm --filter @quartermaster/api test`: 29 files, 344 tests).

### Code paths

| Piece | Where |
| --- | --- |
| Ledger table | `apps/api/src/db/schema.ts` (`ledgerEntries`), `apps/api/drizzle/0005_ledger_entries.sql` |
| Ledger helpers | `apps/api/src/db/ledger.ts` (`recordLedgerEntry`, `listLedger`, `findIncomeByCapture`, `clearedIncome`) |
| Paid-invoice handler | `apps/api/src/webhooks/handlers/invoice-paid.ts` |
| Capture handler | `apps/api/src/webhooks/handlers/capture-completed.ts` |
| Refund / reversal handler | `apps/api/src/webhooks/handlers/capture-reversed.ts` |
| Handler registration | `apps/api/src/webhooks/handlers/index.ts` (`registerLedgerHandlers`), called once by `index.ts`, not by `createApp()` |
| Real event fixture | `apps/api/src/webhooks/handlers/fixtures/invoice-paid.json` (a real sandbox event, emails redacted) |
| Invoicing client | `apps/api/src/paypal/invoicing.ts` |
| Draft builder | `apps/api/src/invoices/draft.ts` |
| Send service | `apps/api/src/invoices/send.ts` |
| Routes | `apps/api/src/routes/invoices.ts`, mounted at `/api/sponsors` |
| Treasury agent | `apps/api/src/agents/treasury.ts`, `apps/api/src/agents/tools/treasury.ts` |

## The API

Both routes need the `x-treasurer-token` header. With no `TREASURER_TOKEN` configured they answer 503, so they fail closed. This is an interim guard: Log in with PayPal sessions (F1, PR #16) are coming and will replace it.

`GET /api/sponsors/:sponsorId/draft` returns `{ sponsor, event, draft }`. The draft is the shared `InvoiceDraft`, with amounts in cents. Nothing is sent.

`POST /api/sponsors/:sponsorId/send` takes `{ draft, recipientEmail }` and returns `{ paypalInvoiceId, invoiceNumber, recipientViewUrl, resumed }`. The treasurer may edit the draft's note and items, but the total must still equal the pledge.

| Status | Meaning |
| --- | --- |
| 200 | Sent. `resumed: true` means an earlier attempt had created the PayPal invoice and this one finished it. |
| 400 | The sponsor id is not a UUID. |
| 401 / 503 | Wrong token / no token configured. 503 also when the database or the PayPal Treasury app is not configured. |
| 404 | No such sponsor. |
| 409 | Refused, with a `code`: `already_invoiced`, `already_paid`, `stale_invoice` (the PayPal invoice was cancelled or refunded and needs clearing by hand), `in_progress` (another attempt is creating the invoice right now), `duplicate_invoice` (PayPal has more than one open invoice for this sponsor) or `invoice_mismatch` (an invoice found at PayPal is for another sponsor or another amount). |
| 422 | Bad body, or the draft does not match the pledge, sponsor and currency (`draft_mismatch`). |
| 502 | PayPal rejected the request. The body carries PayPal's `debugId`. |

## Design decisions

**No double invoicing.** PayPal's invoice create takes no `PayPal-Request-Id` (checked against the OpenAPI spec), so PayPal will not stop a retry from creating a second invoice. The send service does it instead:

- an advisory lock serializes sends per sponsor, so a double click waits and is then refused;
- the `invoice.create` audit row is committed **before** PayPal's create is called. It marks the attempt and acts as a 5-minute lease: while it is fresh, has no PayPal id and no `invoice.failed` after it, other attempts get 409 `in_progress`;
- every invoice carries the sponsor id as `detail.reference`. If an earlier attempt left a create with no PayPal id (a crash or timeout after PayPal may have made the invoice), the next attempt after the lease looks it up with `search-invoices` by that reference before creating another. One open match is recovered (`invoice.recovered`), more than one is refused (`duplicate_invoice`), and a match for another sponsor or amount is refused (`invoice_mismatch`);
- the PayPal invoice id is committed on the sponsor and the audit row as soon as the create returns, before sending, so a send that fails halfway is finished by the next attempt (`resumed: true`), not duplicated;
- a sponsor that is already `invoiced` or `paid` is refused, and the sponsor moves to `invoiced` only from `pledged`, so a send can never overwrite a `paid` set by the webhook.

**The draft is never trusted.** The confirmed draft must match the sponsor, the currency and the full pledge. A tampered amount is refused with 422.

**The agent cannot move money or change the ask.** The treasury agent has two read-only tools (`list_sponsors_to_invoice`, `draft_sponsor_invoice`), no PayPal client, no DB handle and no send tool. It chooses a sponsor and, optionally, the due days (0 to 90). The amount is the pledge and the treasurer types the recipient. The wording is ours on the agent path; the send route still accepts the treasurer's edited note and items. It only sees sponsors of its own chat's event, only `pledged` sponsors can be drafted, and sponsor names reach the model only as delimited untrusted data.

**Only fully settled invoices count as income.** PayPal fires `INVOICING.INVOICE.PAID` for partial and pending payments too. The handler requires status `PAID`, nothing due, and a `SUCCESS` PayPal transaction. `MARKED_AS_PAID` (the invoicer's own claim of cash or cheque) is ignored, because it is not money PayPal moved.

**Captures count net of fees, invoices gross.** A Treasury capture is recorded at `seller_receivable_breakdown.net_amount`, what actually landed. If PayPal omits it, the gross amount is recorded and the audit row says so. The invoice event carries no fee, so a paid invoice is recorded gross.

**Refunds and chargebacks reduce income.** `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED` on the Treasury app write one `income_reversal` row (direction `out`, net when PayPal gives a net amount), and `clearedIncome` subtracts it. Only a capture this ledger recorded as income is undone; anything else is audited as `ledger.reversal_unmatched`. Procurement-app refunds (P4's late-delivery case) are left to P4's handler.

**A replayed webhook cannot double-count.** P2's event store forgets event ids on a restart, so the ledger protects itself: `(source, paypal_id)` is unique, and the handler is a no-op the second time.

**Captures need a tag.** A Treasury `PAYMENT.CAPTURE.COMPLETED` is credited only if its `custom_id` was built with `buildCaptureTag(eventId, 'ticket' | 'donation', sponsorId?)`. Anything else is audited as `ledger.capture_unmatched`, never guessed. Procurement captures are spend and are ignored here. Whoever creates Treasury orders (P2) must set this tag.

**Every step is audited:** `invoice.create`, `invoice.recovered`, `invoice.sent`, `invoice.failed`, `ledger.income_recorded`, `ledger.income_reversed`, `ledger.invoice_ignored` / `ledger.invoice_unmatched`, `ledger.capture_ignored` / `ledger.capture_unmatched`, `ledger.reversal_ignored` / `ledger.reversal_unmatched`, and the treasury agent's tool calls (actor `treasury`, including what `draft_sponsor_invoice` actually drafted).

## Evidence from the real sandbox

| What | Result |
| --- | --- |
| Day-1 invoice `INV2-KUAD-G3SZ-RL4H-P6QK` | Paid by the sandbox personal account. PayPal generated `INVOICING.INVOICE.PAID`, event `WH-5BB64834SP633240L-14U076465L565262C`. That event is the handler's test fixture. |
| Day-1 payout batch `PZN4R5F4LG5NY` | `SUCCESS`. PayPal generated `PAYMENT.PAYOUTSBATCH.SUCCESS`, event `WH-5UE82990P34269438-65M4346561924914E`. |
| Earlier invoice code | Sent a $1.00 invoice, `INV2-2SFS-ZWAG-ZJA8-9KRJ` (number 0002), which PayPal accepted. No request or response for it is committed, and the body has changed since: `payment_term` now sends only `due_date` (or `term_type: DUE_ON_RECEIPT` when due in 0 days), and `detail.reference` is set. The current shape is verified in the next row. This invoice is unpaid. |
| Current invoice code (2026-10-29) | Two drafts created with the merged `createInvoice`, tagged with one test reference, never sent, then deleted. `INV2-KU48-3J24-FRP3-RQUV` (due on a date, `payment_term: { due_date }` only): accepted; PayPal stored it as `term_type: DUE_ON_DATE_SPECIFIED` with the due date. `INV2-PQE4-TERG-9VEF-LAR2` (`term_type: DUE_ON_RECEIPT`): accepted. Both read back with the reference and a total of 100 USD minor units. `searchInvoicesByReference` found 2 of 2. Both drafts deleted (`DELETE /v2/invoicing/invoices/{id}`). |
| Treasury webhook | P2's receiver at `quartermaster-staging.onrender.com/api/webhooks/paypal/treasury` is subscribed to `INVOICING.INVOICE.PAID`, `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.PAYOUTSBATCH.SUCCESS`. |

**Verified in the sandbox on 2026-10-29** (Treasury app, the code merged in PRs #20 to #22): a `due_date`-only payment term and a `detail.reference` are accepted, search by reference returns the invoice, and drafts can be deleted. The run is in the evidence table above. The search returns every invoice with that reference, so a sponsor's earlier invoice is found as well; the send service relies on that.

**Not confirmed:** whether PayPal's events reached the staging receiver and were answered with a 2xx. PayPal's event list shows they were generated, not delivered. Check the developer dashboard's webhook events or the Render logs. The subscription list above does not include `PAYMENT.CAPTURE.REFUNDED` / `REVERSED`.

The agent has been tested with a scripted model only, as the project rules require. It has not been run against a real model.

## Known limitations

- **Invoice income is gross**, the amount the sponsor paid, before PayPal's fee, because the invoice event carries no fee. Captures are net. Unlocked budget can read slightly high for invoices until fees are reconciled from Transaction Search.
- **A refunded sponsor stays `paid`.** The reversal lowers cleared income, but `sponsors.status` is not changed. Open TODO in `capture-reversed.ts`: drive it from `INVOICING.INVOICE.REFUNDED` and re-close the sponsor's Gantt gate there.
- **The sponsor's email is not stored.** The `sponsors` table has no `contact_email`, so the treasurer types it when confirming. A column would be another migration.
- **There is no confirm screen.** Today the treasurer confirms through the API. The chat returns the structured drafts (`delegate_to_treasury` gives `{ summary, drafts, sent: false }`), so a button can be built on them.
- **No read endpoint for the ledger.** Checking it means a query, or `listLedger` / `clearedIncome` in code.
- **Not handled yet:** `INVOICING.INVOICE.REFUNDED` (see above), subscriptions (`BILLING.SUBSCRIPTION.ACTIVATED`, F7; the Treasury webhook is not subscribed to it), reminders (F5) and partial payments. The last two need an `invoices` table.
- **The APIMatic plugin was not used** for these wrappers. The shapes came from PayPal's OpenAPI specs and real sandbox runs. See `docs/apimatic-log.md`. The README must not claim plugin use for these wrappers unless the Invoicing calls are re-checked with the plugin and logged.

## Dependencies on other roles

| Who | What is needed | Why |
| --- | --- | --- |
| P2 | Any open branch that adds a migration (for example `p2/order-approved`) regenerates it on top of `0005` (`pnpm --filter @quartermaster/api db:generate`) | A numbering clash breaks the migration journal |
| P2 | Run the migrations on the shared database and deploy staging | The ledger table and handlers must exist where the webhook lands |
| P2 | Check, and if needed add, the Treasury webhook subscription to `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED` | Otherwise refunds never reduce cleared income |
| P2 | Set `custom_id` with `buildCaptureTag()` when creating Treasury orders for tickets and donations | Otherwise those captures cannot be credited to an event |
| P1 | Build the funds-gated budget (F10) on `clearedIncome(db, eventId, currency)` | "Unlocked budget" does not exist yet, so the second half of the goal cannot be shown |
| P1 / P2 | Decide whether `sponsors` gets a `contact_email` column | The treasurer types the email until then |
| P4 | Release Gantt tasks funded by a sponsor whose status becomes `paid` | The demo payoff of a paid invoice |
| P4 | Decide where the invoice confirm screen lives | There is none yet |

## What is left to complete Stage 1

1. Done: #20, #21 and #22 are merged into `development`.
2. P2 runs the migrations and deploys staging.
3. Run the "to verify in the sandbox" checklist above for the current invoice shape.
4. **Run the end-to-end check below on staging.** This is the proof of the Stage 1 goal.
5. Build the confirm screen with P4 (otherwise the demo confirms through the API).
6. Add Invoicing to the README "PayPal capabilities used" table with its code paths. The team's PayPal rules require it for the judges.
7. Optional: reconcile invoice fees from Transaction Search, and decide on the APIMatic plugin evidence.

## End-to-end check

Run once staging is deployed from the merged code.

1. Pick a pledged sponsor of the seeded event and note its id.
2. `GET /api/sponsors/<id>/draft` with the `x-treasurer-token` header. Check the amount equals the pledge.
3. `POST /api/sponsors/<id>/send` with `{ "draft": <the draft>, "recipientEmail": "<sandbox personal account email>" }`. Expect 200 and a `recipientViewUrl`.
4. Check the sponsor is now `invoiced` with a `paypal_invoice_id`, the invoice's `detail.reference` at PayPal is the sponsor id, and a second `POST` returns 409 `already_invoiced`.
5. Open the `recipientViewUrl` in a private window, log in as the sandbox personal account, and pay.
6. Wait for the webhook. In the database, expect one `ledger_entries` row (`sponsor_invoice`, the invoice id as `paypal_id`), the sponsor `paid`, and an `ledger.income_recorded` audit row.
7. Replay the event from the PayPal developer dashboard. Expect still one ledger row.
8. When P1's budget exists, check that unlocked budget rose by the invoice amount.

If step 6 shows nothing, look for `ledger.invoice_unmatched` in the audit log (the invoice id is not on any sponsor) and check the staging logs for the webhook.
