---
paths:
  - 'apps/api/**'
  - 'packages/shared/**'
---

# Money safety (rules engine, budget, audit)

Owner: P1. Features: F8 rules compiler, F9 rules engine, F10 budget figures (no longer a gate), F23 audit log.

## The single gate

- `apps/api/src/rules/` exports a pure function `check(spend, rules, budget)` that returns `{ decision: 'allow' | 'needs_approval' | 'block', reasons: string[], ruleIds: string[] }`. It has no I/O, no clock reads (pass `now` in), no randomness, and no LLM calls.
- Money-moving PayPal functions (vault charge, order capture, payout batch, refund) are not exported from `src/paypal/` for general use. They are called only from the executor that runs after `check()` returns `allow`, or after a recorded treasurer approval for `needs_approval`. If you need a new money action, route it through the same executor.
- `block` is final for that request; agents may propose a different spend. `needs_approval` creates an approval record (Approvals screen) and stops; nothing moves until the treasurer approves.
- Every `check()` call writes an `audit_log` row (actor, action, input, reason, rule_result, paypal_id), including `allow`. Write the row before the PayPal call and update it with the PayPal ID after, so a crash mid-call still leaves a trace.

## Rules

- Rules are stored as `source_text` (what the treasurer typed) plus `compiled_json` (zod-validated), with a `version` and `confirmed_by`. Only confirmed versions are enforced; a draft from the rules compiler agent is never live.
- The compiled schema covers at least the five demo rules: per-spend approval threshold ("nothing over $200 without my approval"), category allowlist / approved vendor list ("swag only from the approved list"), per-person-per-day claim cap ("volunteers up to $50 per day"), category budget caps, and payout approval threshold.
- When rules conflict, the strictest wins (block > needs_approval > allow).

## Budget (no funds gate)

- The funds gate and sponsor gate were removed on Nov 6, 2026: the agent pays from the organizer's own PayPal account, so `check()` does not compare a spend with cleared income and does not wait on a sponsor's invoice.
- unlocked = cleared income − committed spend, in integer cents, is still computed (`rules/budget.ts`, `db/budget.ts`) for the home screen, widgets and sponsor report. It is informational only.
- Committed spend still feeds the daily auto-pay cap and the category caps, and includes approved-but-not-captured carts and pending payouts, so two concurrent carts cannot both slip under a cap.
- The organizer's maximum spend is the spending limit: `events.max_spend_minor`, set from the "Add rule" button in the agent chat (`PUT /api/events/:id/max-spend`). `createRulesCheck` adds it as a `max_spend` rule, and `check()` blocks any spend that would take the event's committed total past it. No maximum set means no such limit.

## Tests

`check()` and the budget function must have unit tests for every demo beat. Examples: a $140 cart is allowed, a $420 cart is allowed too (there is no approval step since Nov 9, #115; it is still checked and audited), an off-list vendor is blocked, and a spend after the kill switch is refused. These tests are cheap and are the strongest protection for the demo.
