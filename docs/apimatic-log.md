# APIMatic Context Plugin log

Evidence for the Best Use of APIMatic prize (PRD §8, §15). Owner: P2 (README "APIMatic" section); P3 keeps this log for the Invoicing, Payouts, Transaction Search and Subscriptions code. Add one row per real use of the plugin, with the prompt, what the tools returned, and the files it shaped. Do not log anything the plugin did not produce.

## Install

| Date | Who | What |
| --- | --- | --- |
| 2026-10-27 | P3 | Installed from https://github.com/apimatic/context-matic with the CLI: `claude plugin marketplace add apimatic/context-matic`, then `claude plugin install context-matic@apimatic --scope user`. Version 0.1.0, status enabled. |

Install notes:

- The plugin README says the install name is `context-matic@apimatic-context-matic`. That fails with "not found in marketplace". The marketplace registers as **`apimatic`**, so the working name is `context-matic@apimatic`.
- The plugin provides an MCP server (`context-matic`, `https://chatbotapi.apimatic.io/mcp/plugins`, no credentials) with four tools: `fetch_api`, `ask`, `endpoint_search`, `model_search`. Its `update_activity` milestones are sent to APIMatic. It also has two skills: `/integrate-context-matic` and `/onboard-context-matic`.
- The README lists **PayPal Server SDK** as covering orders, payments, vault, transaction search and subscriptions. Invoicing v2 and Payouts are **not named**, so whether the plugin covers them is an open question (first prompt below).
- The tools only appear in a session after `/reload-plugins` (or a restart). They were not available in the session that installed it, so nothing below has been run yet.

## Honesty note on Stage 0 code

The day-1 scripts in `apps/api/scripts/day1/` and their payloads were written from PayPal's published OpenAPI specs (`https://developer.paypal.com/api/invoicing/v2/schema.json`, `payments.payouts-batch/v1`, `transaction-search/v1`, `webhooks/v1`), **not** from the plugin. They are not evidence of plugin use. Cross-check them with the plugin and log the result.

## Prompts to run next

| # | Prompt (run in Claude Code after `/reload-plugins`) | What to record |
| --- | --- | --- |
| 1 | `/onboard-context-matic` | Tools it lists, the API catalog |
| 2 | `/integrate-context-matic` Which PayPal APIs can you give me for TypeScript? Do you cover Invoicing v2 and Payouts? | Whether `fetch_api` returns `paypal`, and what it covers |
| 3 | Show the endpoint and request model for listing transactions (Transaction Search) in the PayPal Server SDK for TypeScript, and compare it with `apps/api/scripts/day1/search.ts` | Differences found (date format, paging, fields) |
| 4 | If Invoicing or Payouts is covered: show `create`, `send` and `remind` invoice, and the batch payout request, and compare with `invoicing.ts` and `payouts.ts` | Whether the plugin's request shapes match ours |
| 5 | How do I create a subscription plan and subscription with the PayPal Server SDK, and which webhook events fire? | Input for F7 |

## Log

| Date | Who | Prompt | Tools called | What it produced | Files shaped | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

The free subscription form is a PRD §15 checklist item owned by P2: https://paypalaihackathon.devpost.com/details/apimatic
