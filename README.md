# Quartermaster

An AI operations agent for community tech events that runs all of an event's money on PayPal: sponsor money in, purchases and people payouts out, under spending rules no agent can break. Built for the PayPal AI Hackathon. Full spec: [`docs/PRD.pdf`](docs/PRD.pdf).

## Run locally

Prerequisites: Node 22 and pnpm (`corepack enable`).

```sh
pnpm install
cp .env.example .env   # fill in sandbox credentials
pnpm dev               # web on http://localhost:5173, API on http://localhost:3001
```

Other commands: `pnpm build`, `pnpm start` (serves the built web app from the API), `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Repo layout

| Path              | What                                                   |
| ----------------- | ------------------------------------------------------ |
| `apps/web`        | React + Vite front end                                 |
| `apps/api`        | Express API: agents, rules engine, PayPal webhooks     |
| `packages/shared` | API contract types and zod schemas shared by web + API |
| `render.yaml`     | Render Blueprint (web service; Postgres is Supabase)   |

## PayPal capabilities used

_TODO: list each capability with a link to its code path._

| Capability                                                                                                                                    | Code                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth client credentials (per app, cached token)                                                                                              | [`apps/api/src/paypal/client.ts`](apps/api/src/paypal/client.ts)                                                                                                                                               |
| Orders v2: create order, show order                                                                                                           | [`apps/api/src/paypal/orders.ts`](apps/api/src/paypal/orders.ts)                                                                                                                                               |
| Sandbox negative testing (`PayPal-Mock-Response`)                                                                                             | [`apps/api/src/paypal/client.ts`](apps/api/src/paypal/client.ts), [`apps/api/scripts/paypal-smoke.ts`](apps/api/scripts/paypal-smoke.ts) (`pnpm --filter @quartermaster/api paypal:smoke`)                     |
| Invoicing v2: create, send, show, search by reference (sponsor invoices, F4)                                                                  | [`apps/api/src/paypal/invoicing.ts`](apps/api/src/paypal/invoicing.ts), [`apps/api/src/invoices/send.ts`](apps/api/src/invoices/send.ts), [`apps/api/src/routes/invoices.ts`](apps/api/src/routes/invoices.ts) |
| Webhook events into the ledger: `INVOICING.INVOICE.PAID`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED` | [`apps/api/src/webhooks/handlers/`](apps/api/src/webhooks/handlers/), [`apps/api/src/db/ledger.ts`](apps/api/src/db/ledger.ts)                                                                                 |
| Payouts v1: one batch to a sandbox recipient (day-1 check only; production payouts come with F17)                                             | [`apps/api/scripts/day1/payouts.ts`](apps/api/scripts/day1/payouts.ts)                                                                                                                                         |
| Transaction Search: one sandbox query (day-1 check only; reconciliation comes with F20 and F22)                                               | [`apps/api/scripts/day1/search.ts`](apps/api/scripts/day1/search.ts)                                                                                                                                           |

## Sponsor integrations

### AG Studio

The Money screen is an AG Studio command center, themed from `apps/web/src/styles/tokens.css`. Its data sources are built from the shared widget shapes (`packages/shared/src/widgets.ts`); they are filled from the treasurer-only endpoints `GET /api/widgets/*`. The funding thermometer, budget burn and rules health are live, from the ledger, the funds-gated budget and the audit log. Delivery risk and the payouts ledger are labelled sample until P4's orders and F17's payouts exist. A line above the widgets says which is which. If the endpoints cannot be reached (not signed in, no server), the page shows its own sample as a whole and says why, because live sponsor ids would not match sample rows and the cross-filtering would break.

| What                                                                          | Code                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| Studio wiring, lazy-loaded                                                    | `apps/web/src/money/CommandCenter.tsx`          |
| Theme from design tokens                                                      | `apps/web/src/money/studio-theme.ts`            |
| Data sources from the shared shapes                                           | `apps/web/src/money/studio-data.ts`             |
| Default report (KPIs, funding, budget burn, payouts ledger)                   | `apps/web/src/money/initial-report.ts`          |
| Widget endpoints, in the shared shapes                                        | `apps/api/src/routes/widgets.ts`                |
| Data hook: fetch, label the source, fall back                                 | `apps/web/src/money/use-command-center-data.ts` |
| Custom widgets: funding thermometer, budget burn, rules health, delivery risk | `apps/web/src/money/widgets/`                   |

![Money command center, with sample data](docs/p3/screenshots/command-center.png)

Budget burn is a custom widget: for each budget category it shows what was spent (captured) and committed (approved, not yet captured) against the category's cap. A category over its cap says so in words and gets a line at the cap. Clicking a category cross-filters the widgets that share its table. Its numbers are live: committed spend is counted exactly as the rules check counts it, and the caps are the rules in force, so the widget and the rules agree on what is left.

![Budget burn widget](docs/p3/screenshots/budget-burn.png)

Rules health is a third custom widget: how many recent spends the rules allowed, sent to the treasurer or blocked, with each check's amount, category and reasons. A check that has no reasons is labelled, and one with a decision it does not recognise is reported instead of counted.

![Rules health widget](docs/p3/screenshots/rules-health.png)

Delivery risk is the fourth custom widget: the ordered items against their deadlines, most urgent first, with how many are late, at risk, on track or without a delivery date yet. An item with no date says so; it is never shown as arriving on its deadline.

![Delivery risk widget](docs/p3/screenshots/delivery-risk.png)

**Cross-filtering.** A click on a sponsor or a budget category filters the widgets that list individual rows: the payouts ledger, rules health and delivery risk. The funding, budget and KPI widgets ignore other widgets' selections on purpose, because a category total is not a sponsor's and a query that joins one through the other can inflate a sum. Studio's fan-out check is set to refuse such a query (`options.fanout.execute: 'prevent'`). Studio does not tell a custom widget that the filters changed, so `CommandCenter` passes `onStateUpdated` to `apps/web/src/money/widgets/filters-changed.ts`, which makes the row-listing widgets fetch again.

The Stage 2 write-up, with how the cross-filtering works and what is still sample: [`docs/p3/stage-2.md`](docs/p3/stage-2.md). Setup notes and the day-1 PayPal checks: [`docs/p3/stage-0.md`](docs/p3/stage-0.md). The licence key is read from `VITE_AG_STUDIO_LICENSE` and is not committed.

### Bryntum

The Plan screen is a Bryntum Gantt (trial 7.3.7, React wrapper) in [`apps/web/src/plan/`](apps/web/src/plan/). Each sponsor invoice is a task, and the purchases that sponsor funds depend on it, so they stay blocked until PayPal reports the invoice paid. Event day is a fixed milestone. Task colors and the Gantt theme come from the same design tokens as the rest of the app.

_Status: hello world on a static slice of the demo plan. Next: live tasks from the planning agent (F11), tracking dates (F18) and the late-delivery cascade (F19). Screenshot of the invoice-gated cascade to come._

### Channel3

_TODO (P1)_

## Agent loop (P1)

The Event home chat is a tool loop, not a single completion. An orchestrator agent writes a checklist for the organizer's goal, works through it with tools, and stops when every item is done or blocked. The checklist is saved as a mandate in Postgres (Supabase), so it survives reloads.

| Piece                                     | Code                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator (read, checklist, delegate)  | [`apps/api/src/agents/orchestrator.ts`](apps/api/src/agents/orchestrator.ts)                                                            |
| Planning subagent (its PRD §7 tools only) | [`apps/api/src/agents/planning.ts`](apps/api/src/agents/planning.ts), [`tools/`](apps/api/src/agents/tools)                             |
| Streaming chat route + rate limit         | [`apps/api/src/routes/chat.ts`](apps/api/src/routes/chat.ts)                                                                            |
| Schema, migrations, seed                  | [`apps/api/src/db/schema.ts`](apps/api/src/db/schema.ts), [`apps/api/drizzle/`](apps/api/drizzle), [`seed.ts`](apps/api/src/db/seed.ts) |
| Web chat with live checklist              | [`apps/web/src/chat/AgentChat.tsx`](apps/web/src/chat/AgentChat.tsx)                                                                    |

Setup: set `DATABASE_URL` (Supabase transaction pooler), then `pnpm --filter @quartermaster/api db:migrate && pnpm --filter @quartermaster/api db:seed`.

Safety: no agent has a money tool yet. Procurement and treasury subagents arrive with the rules engine, and every money call will pass `check()`. Every tool call writes an `audit_log` row with its input and a one-sentence reason.

Differs from the PRD: the database is Supabase Postgres instead of Render Postgres, and the orchestrator is a sixth agent (it holds no money tools). Update the PRD to match.

### Render

_TODO (P2)_

### APIMatic

We use the APIMatic Context Plugin (`context-matic@apimatic`, MCP server `context-matic`) in Claude Code to check PayPal request shapes. Only calls the plugin actually answered are listed. The PayPal client code in `apps/api/src/paypal/` was written before the plugin was running on this machine, so the entries below are a cross-check of that code, not its origin.

| Date       | Tool                               | Prompt or query                                                                                | What it returned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Files checked                               |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 2026-10-29 | `fetch_api` (typescript, `paypal`) | `paypal`                                                                                       | One API, "PayPal Server SDK": Orders, Payments, US-only Vault, Transaction Search, Subscriptions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | n/a                                         |
| 2026-10-29 | `ask`                              | Log in with PayPal: authorization URL, code-for-token exchange, `/v1/identity/oauth2/userinfo` | **Not covered.** The SDK documents only the client-credentials grant; no Identity or userinfo endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | F1 (`apps/api/src/auth/`), see note below   |
| 2026-10-29 | `ask`                              | How do I create a Vault setup token for a PayPal wallet?                                       | `VaultController.createSetupToken` with `paymentSource.paypal`; SDK `@paypal/paypal-server-sdk@2.0.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `apps/api/src/paypal/vault.ts`              |
| 2026-10-29 | `model_search`                     | `VaultPaypalWalletRequest`, `PaypalWalletExperienceContext`                                    | Confirms every field we send exists: `usageType`, `customerType`, `permitMultiplePaymentTokens`, `experienceContext.returnUrl/cancelUrl`, `shippingPreference`, `userAction`, `vaultId`. Optional `usagePattern` is one we do not send                                                                                                                                                                                                                                                                                                                                                                                                         | `vault.ts`, `orders.ts`                     |
| 2026-10-29 | `endpoint_search`                  | `userinfo`, `RequestToken`                                                                     | No Identity endpoint. Returned unrelated Orders, Payments, Subscriptions, Transaction Search and Vault methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | n/a                                         |
| 2026-11-01 | `model_search`                     | `PurchaseUnitRequest`                                                                          | Which order field can carry our event id. `customId` is the "API caller-provided external ID… used to reconcile transactions… appears in transaction and settlement reports"; `referenceId` is the purchase unit's id (ours already); `invoiceId` must be unique per merchant account. Decision: the event id goes in `custom_id`. The related `Order.links` text also says an order opened without the PayPal button needs a `return_url`, or the payer sees an error page after approving; this matches the loop we saw on a manually opened approval link (not yet proven to be the cause); the Approvals page uses PayPal's button instead | `apps/api/src/paypal/orders.ts`, `spend.ts` |

Not answered (the tool returned "An error occurred invoking 'ask'"): a long multi-part Vault question, a long Orders-with-`vault_id` question, and the short `How do I create an order paid with a vaulted PayPal token (vault_id)?`. Short single-topic questions worked best.

Gap worth telling APIMatic: the plugin has no coverage of PayPal Identity (Log in with PayPal), which our F1 needs. F1 request shapes therefore come from PayPal's own developer documentation, and the code is not attributed to the plugin.

## License

MIT
