---
paths:
  - 'apps/api/src/agents/**'
---

# AI agents

Owner: P1, with P3 for the treasury and dashboard agents. Runtime: Vercel AI SDK, with the model set by env config so it can be swapped. Develop on a cheap or free model and switch to a stronger one for the demo recording. The team's own budget is $20 in total.

## The five agents and their only tools

| Agent          | Tools                                                                                 | Human gate                                        |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Rules compiler | `propose_rules` (write-only draft)                                                    | Treasurer confirms before rules go live           |
| Planning       | `create_tasks`, `link_task_to_invoice`, `read_event`                                  | Organizer edits the plan freely                   |
| Procurement    | `build_cart`, `request_payment` (goes to rules engine)                                | Approval above threshold or outside the rules     |
| Treasury       | Invoicing tools, receipt extraction (vision), `request_payout` (goes to rules engine) | Treasurer approves payout batches above threshold |
| Dashboard      | AG Studio built-in agents, Transaction Search reader                                  | None (read-only)                                  |

- An agent gets exactly the tools in its row. Do not give any agent a raw PayPal client, a DB handle or a generic HTTP tool.
- `request_payment` and `request_payout` return the rules-engine decision to the agent. They never bypass it.

## Output handling

- Every agent returns structured output validated by a zod schema (use the AI SDK's structured-output helpers). On a parse failure, retry once, then surface the case to a human. Never guess.
- Receipt extraction uses a fixed schema: merchant, date, total, currency, line items. Low-confidence fields go to human review rather than auto-payout.
- Store a short reasoning summary per action for the audit log and the Approvals screen ("why the agent picked this").

## Prompt injection

Product pages, receipts, invoice notes and sponsor emails are untrusted. Pass them as clearly delimited data, never concatenated into instructions, and never let their content change the tool list, the rules or the recipients.

## Cost and demo safety

- Per-session rate limit on the hosted demo, so judges cannot exhaust the quota.
- Cache the planning agent's output for the seeded demo goal, so the demo works even when the LLM is slow or out of credit.
- Agent tests mock the model. Do not call a real LLM from `pnpm test`.
