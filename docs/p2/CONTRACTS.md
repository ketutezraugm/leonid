# P2 contracts: what I give, what I need

Local only. Dates are 2026. A contract is "done" when it is merged into `development` and announced in chat.

## I give

| Contract | Consumer | Shape | Due |
| --- | --- | --- | --- |
| Docker Postgres, `db:up` / `db:migrate` / `db:seed`, `.env.example` keys | everyone | `postgres:18`, Drizzle, `pg` | Wed Oct 28 (skeleton), Thu Oct 29 (full) |
| DB schema: all PRD section 9 tables + `users`, `sessions`, `webhook_events`, `approvals`, `demo_token_pool` | everyone | `apps/api/src/db/schema.ts`; money = integer cents + ISO currency | Thu Oct 29 |
| Shared schemas: session, wallet status, approval, treasury balance | Harfi, Abel | `packages/shared`, zod, additive only | Thu Oct 29 |
| PayPal client core + treasury/procurement clients | Harfi, Jose | `apps/api/src/paypal/`; money-moving calls importable only by the executor | Fri Oct 30 |
| Webhook dispatcher | Jose, Abel | `registerHandler(eventType, handler)`; handlers idempotent on event id; raw body verified before dispatch | Fri Oct 30 |
| Payment executor | Harfi | `execute(spend, decision)` runs only after `check()` = allow or a recorded approval; audit row before and after the PayPal call | Sun Nov 1 |
| Approvals API + page | Harfi, Abel | list/approve/reject; reasoning from the cart | Mon Nov 2 |
| Kill switch + demo token pool | all | revoke wallet; "Reset demo" activates the next pooled token | Mon Nov 2 |
| Internal jobs endpoints | workflows | `POST /api/internal/jobs/:name`, shared-secret header | Wed Nov 4 |

## I need

| From | Need | Why | By |
| --- | --- | --- | --- |
| Harfi | `check(spend, rules, budget)` type and a stub, plus the audit-log writer signature | executor depends on the decision type | Wed Oct 28 (type), Sun Nov 1 (real) |
| Harfi | Grant repo access to the Render workspace; promote `development` to `main` at gates | deploys | Wed Oct 28 |
| Harfi | LLM provider module (model id by env) | none for P2 directly | n/a |
| Jose | `INVOICING.INVOICE.PAID` handler: unlock only when the invoice is fully paid (the event also fires for partial or pending payments) | funds-gated budget | Fri Nov 7 |
| Jose | Payout batch function signature (`request_payout` through the rules engine) | executor routes payouts | Wed Nov 4 |
| Abel | Approvals page layout and design tokens usage; wallet/kill-switch card placement on Event home | I build the logic, Abel owns the design system | Sat Oct 31 |
| Abel | Handlers for `PAYMENT.CAPTURE.COMPLETED` (tracking/plan updates) | Gantt updates | Fri Nov 7 |

## Rules for shared files

- `packages/shared`: additive only; post in chat before merging.
- Schema and migrations: teammates may edit `schema.ts` in their PR, but only I run `drizzle-kit generate` (after rebasing).
- `pnpm-lock.yaml`: never hand-merge; take `development`'s version and rerun `pnpm install`.
- `apps/api/src/app.ts`: one mounted router line per owner.
- `.env.example`: append only; values stay out of git.
