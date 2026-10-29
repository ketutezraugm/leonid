# P3 Stage 1: F4 sponsor invoices

Owner: P3. Source: PRD §7 (treasury agent), §14 (day-1 tests) and the Stage 1 plan. Reader: the team (P1, P2, P4) and P3.

**Status: the code is finished and tested, but Stage 1 is not complete until the three pull requests below are merged and the end-to-end check at the bottom has been run on staging.** Items that are not done are marked as such throughout.

The Stage 1 goal was: an invoice arrives in the sponsor's sandbox account, and paying it raises the unlocked budget.

| Half of the goal | State |
| --- | --- |
| An invoice arrives in the sponsor's sandbox account | Shown. The production code sent a real sandbox invoice and PayPal accepted it (evidence below). |
| Paying it raises the unlocked budget | **Not shown yet.** The code that writes the income is built and tested, but it needs the PRs merged and P1's budget function, which does not exist yet. |

## How a sponsor invoice flows

```
organizer: "invoice Harbor Cloud"
   -> treasury agent drafts (the pledge, one line, due in 14 days). It cannot send.
   -> treasurer reviews the draft and types the sponsor's email
   -> POST /api/sponsors/:id/send  (treasurer token)
        creates + sends the PayPal invoice, saves paypal_invoice_id, sponsor -> 'invoiced'
   -> sponsor pays on PayPal
   -> PayPal fires INVOICING.INVOICE.PAID -> POST /api/webhooks/paypal/treasury
        handler: fully paid? -> one ledger row (cleared income) + sponsor -> 'paid'
   -> P1's budget: unlocked = cleared income - committed spend     (not built yet)
   -> P4's Gantt: tasks funded by that sponsor are released        (P4)
```

## What was built

Three branches, three pull requests into `development`.

| Branch | What it adds | Tests |
| --- | --- | --- |
| `p3/ledger-income-handlers` | `ledger_entries` table (migration `0003`), ledger helpers, and the `INVOICING.INVOICE.PAID` and `PAYMENT.CAPTURE.COMPLETED` webhook handlers | 27 |
| `p3/f4-invoice-flow` | Invoicing v2 client, the draft builder, the send service and the treasurer-only routes | 39 |
| `p3/f4-treasury-agent` | The treasury subagent and the orchestrator's `delegate_to_treasury` tool | 12 |

`p3/f4-treasury-agent` is stacked on `p3/f4-invoice-flow`, so merge that one first. The ledger branch is independent of the other two. A dry-run merge showed all three merge cleanly with each other, with `development` and with P2's open branches.

### Code paths

| Piece | Where |
| --- | --- |
| Ledger table | `apps/api/src/db/schema.ts` (`ledgerEntries`), `apps/api/drizzle/0003_ledger_entries.sql` |
| Ledger helpers | `apps/api/src/db/ledger.ts` (`recordLedgerEntry`, `listLedger`, `clearedIncome`) |
| Paid-invoice handler | `apps/api/src/webhooks/handlers/invoice-paid.ts` |
| Capture handler | `apps/api/src/webhooks/handlers/capture-completed.ts` |
| Handler registration | `apps/api/src/webhooks/handlers/index.ts`, imported once by `app.ts` |
| Real event fixture | `apps/api/src/webhooks/handlers/fixtures/invoice-paid.json` (a real sandbox event, emails redacted) |
| Invoicing client | `apps/api/src/paypal/invoicing.ts` |
| Draft builder | `apps/api/src/invoices/draft.ts` |
| Send service | `apps/api/src/invoices/send.ts` |
| Routes | `apps/api/src/routes/invoices.ts`, mounted at `/api/sponsors` |
| Treasury agent | `apps/api/src/agents/treasury.ts`, `apps/api/src/agents/tools/treasury.ts` |

## The API

Both routes need the `x-treasurer-token` header. With no `TREASURER_TOKEN` configured they answer 503, so they fail closed.

`GET /api/sponsors/:sponsorId/draft` returns `{ sponsor, event, draft }`. The draft is the shared `InvoiceDraft`, with amounts in cents. Nothing is sent.

`POST /api/sponsors/:sponsorId/send` takes `{ draft, recipientEmail }` and returns `{ paypalInvoiceId, invoiceNumber, recipientViewUrl, resumed }`.

| Status | Meaning |
| --- | --- |
| 200 | Sent. `resumed: true` means an earlier attempt had created the PayPal invoice and this one finished it. |
| 400 | The sponsor id is not a UUID. |
| 401 / 503 | Wrong token / no token configured. |
| 404 | No such sponsor. |
| 409 | Already invoiced, already paid, or the PayPal invoice was cancelled and needs clearing by hand. |
| 422 | Bad body, or the draft does not match the pledge, sponsor and currency. |
| 502 | PayPal rejected the request. The body carries PayPal's `debugId`. |

## Design decisions

**No double invoicing.** PayPal's invoice create takes no `PayPal-Request-Id` (checked against the OpenAPI spec), so PayPal will not stop a retry from creating a second invoice. The send service does it instead:

- an advisory lock serializes sends per sponsor, so a double click waits and is then refused;
- the PayPal invoice id is saved before the invoice is sent, so a send that fails halfway is finished by the next attempt, not duplicated;
- a sponsor that is already `invoiced` or `paid` is refused.

**The draft is never trusted.** The confirmed draft must match the sponsor, the currency and the full pledge. A tampered amount is refused with 422.

**The agent cannot move money or change the ask.** The treasury agent has two read-only tools (`list_sponsors_to_invoice`, `draft_sponsor_invoice`), no PayPal client, no DB handle and no send tool. It chooses a sponsor and, optionally, the due days (0 to 90). The amount is the pledge, the wording is ours and the treasurer types the recipient. It only sees sponsors of its own chat's event, and only `pledged` sponsors can be drafted.

**Only fully settled invoices count as income.** PayPal fires `INVOICING.INVOICE.PAID` for partial and pending payments too. The handler requires status `PAID`, nothing due, and a `SUCCESS` PayPal transaction. `MARKED_AS_PAID` (the invoicer's own claim of cash or cheque) is ignored, because it is not money PayPal moved.

**A replayed webhook cannot double-count.** P2's event store forgets event ids on a restart, so the ledger protects itself: `(source, paypal_id)` is unique, and the handler is a no-op the second time.

**Captures need a tag.** A Treasury `PAYMENT.CAPTURE.COMPLETED` is credited only if its `custom_id` was built with `buildCaptureTag(eventId, 'ticket' | 'donation', sponsorId?)`. Anything else is audited as `ledger.capture_unmatched`, never guessed. Procurement captures are spend and are ignored here. Whoever creates Treasury orders (P2) must set this tag.

**Every step is audited:** `invoice.create`, `invoice.sent`, `invoice.failed`, `ledger.income_recorded`, `ledger.invoice_unmatched`, `ledger.capture_unmatched`, and the agent's `treasury:*` actions.

## Evidence from the real sandbox

| What | Result |
| --- | --- |
| Day-1 invoice `INV2-KUAD-G3SZ-RL4H-P6QK` | Paid by the sandbox personal account. PayPal generated `INVOICING.INVOICE.PAID`, event `WH-5BB64834SP633240L-14U076465L565262C`. That event is the handler's test fixture. |
| Day-1 payout batch `PZN4R5F4LG5NY` | `SUCCESS`. PayPal generated `PAYMENT.PAYOUTSBATCH.SUCCESS`, event `WH-5UE82990P34269438-65M4346561924914E`. |
| Production invoice code | Sent a real $1.00 invoice, `INV2-2SFS-ZWAG-ZJA8-9KRJ` (number 0002). PayPal accepted the due date and business-recipient shape. This invoice is **unpaid**. |
| Treasury webhook | P2's receiver at `quartermaster-staging.onrender.com/api/webhooks/paypal/treasury` is subscribed to `INVOICING.INVOICE.PAID`, `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.PAYOUTSBATCH.SUCCESS`. |

**Not confirmed:** whether PayPal's events reached the staging receiver and were answered with a 2xx. PayPal's event list shows they were generated, not delivered. Check the developer dashboard's webhook events or the Render logs.

The agent has been tested with a scripted model only, as the project rules require. It has not been run against a real model.

## Known limitations

- **Amounts are gross**, the amount the payer paid, before PayPal's fee. The invoice event carries no fee. Unlocked budget can read slightly high until fees are reconciled from Transaction Search.
- **The sponsor's email is not stored.** The `sponsors` table has no `contact_email`, so the treasurer types it when confirming. A column would be another migration.
- **There is no confirm screen.** Today the treasurer confirms through the API. The chat returns the structured drafts (`delegate_to_treasury` gives `{ summary, drafts, sent: false }`), so a button can be built on them.
- **No read endpoint for the ledger.** Checking it means a query, or `listLedger` / `clearedIncome` in code.
- **Not handled yet:** refunds (`PAYMENT.CAPTURE.REFUNDED`, P4's flow), subscriptions (`BILLING.SUBSCRIPTION.ACTIVATED`, F7; the Treasury webhook is not subscribed to it), reminders (F5) and partial payments. The last two need an `invoices` table.
- **The APIMatic plugin was not used** for these wrappers. The shapes came from PayPal's OpenAPI specs and real sandbox runs. See `docs/apimatic-log.md`. The README must not claim plugin use for these wrappers unless the Invoicing calls are re-checked with the plugin and logged.

## Dependencies on other roles

| Who | What is needed | Why |
| --- | --- | --- |
| P3 | Open the three PRs (`gh` is not installed on P3's machine, so they are opened from compare links) | Nothing merges without them |
| P2 | Review and merge; settle the `0003` migration. `p2/db-adapters` and `p2/order-approved` also add a `0003` migration, so whichever lands second must regenerate its own (`pnpm --filter @quartermaster/api db:generate`). | A numbering clash breaks the migration journal |
| P2 | Run the migration on the shared database and deploy staging | The ledger table and handlers must exist where the webhook lands |
| P2 | Set `custom_id` with `buildCaptureTag()` when creating Treasury orders for tickets and donations | Otherwise those captures cannot be credited to an event |
| P1 | Build the funds-gated budget (F10) on `clearedIncome(db, eventId, currency)` | "Unlocked budget" does not exist yet, so the second half of the goal cannot be shown |
| P1 | Review the change to `agents/orchestrator.ts` and its tool-list test | It is their file. The prompt now says invoices can be drafted, never sent. |
| P1 / P2 | Decide whether `sponsors` gets a `contact_email` column | The treasurer types the email until then |
| P4 | Release Gantt tasks funded by a sponsor whose status becomes `paid` | The demo payoff of a paid invoice |
| P4 | Decide where the invoice confirm screen lives | There is none yet |

## What is left to complete Stage 1

1. Merge the three PRs: `p3/ledger-income-handlers`, `p3/f4-invoice-flow`, then `p3/f4-treasury-agent`.
2. P2 runs the migration and deploys staging.
3. **Run the end-to-end check below on staging.** This is the proof of the Stage 1 goal.
4. Build the confirm screen with P4 (otherwise the demo confirms through the API).
5. Add Invoicing to the README "PayPal capabilities used" table with its code paths. The team's PayPal rules require it for the judges.
6. Optional: reconcile fees from Transaction Search, and decide on the APIMatic plugin evidence.

## End-to-end check

Run after the PRs are merged and staging is deployed.

1. Pick a pledged sponsor of the seeded event and note its id.
2. `GET /api/sponsors/<id>/draft` with the `x-treasurer-token` header. Check the amount equals the pledge.
3. `POST /api/sponsors/<id>/send` with `{ "draft": <the draft>, "recipientEmail": "<sandbox personal account email>" }`. Expect 200 and a `recipientViewUrl`.
4. Check the sponsor is now `invoiced` with a `paypal_invoice_id`, and a second `POST` returns 409.
5. Open the `recipientViewUrl` in a private window, log in as the sandbox personal account, and pay.
6. Wait for the webhook. In the database, expect one `ledger_entries` row (`sponsor_invoice`, the invoice id as `paypal_id`), the sponsor `paid`, and an `ledger.income_recorded` audit row.
7. Replay the event from the PayPal developer dashboard. Expect still one ledger row.
8. When P1's budget exists, check that unlocked budget rose by the invoice amount.

If step 6 shows nothing, look for `ledger.invoice_unmatched` in the audit log (the invoice id is not on any sponsor) and check the staging logs for the webhook.
