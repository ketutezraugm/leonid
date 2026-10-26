---
paths:
  - 'render.yaml'
  - 'apps/workflows/**'
  - 'apps/api/src/jobs/**'
---

# Render (hosting and Workflows)

Owner: P2. Prize: Best Use of Render ($1,000 / $750 / $500 credits). Sponsor page: https://paypalaihackathon.devpost.com/details/render. The requirements below come from PRD §8; verify the Workflows SDK package name and setup against that page and Render's docs.

- **What judges want:** deploy on Render, and use Render Workflows to coordinate agents and background jobs.
- **Hosting:** `render.yaml` defines one web service (the API also serves the built web app) plus Postgres.
  - Do not set `NODE_ENV=production` as a service env var, because pnpm would skip the devDependencies the build needs. The API `start` script sets it.
  - Use a paid plan on sponsor credits, since free instances sleep and free Postgres expires before judging ends.
- **Workflows** (PRD §9). Each one is a durable job that calls the API's own functions, not a copy of the logic:

| Workflow          | Trigger                              | Steps                                                                                      |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Budget recompute  | Any money webhook                    | Recompute unlocked budget; block or unblock dependent tasks                                |
| Invoice reminders | Daily (manual trigger for the demo)  | Find overdue invoices; draft a reminder; send; log                                         |
| Delivery check    | Hourly (manual trigger for the demo) | Compare expected delivery with the deadline; if late, refund, re-source and shift the plan |
| Payout batch      | Claims approved or prizes confirmed  | Group items; run rules; create the PayPal payout batch; wait for the webhook               |
| Sponsor report    | After the event                      | Pull Transaction Search; attribute spend; AI writes the report; publish                    |

- Every workflow that moves money still goes through the rules engine (see `money-safety.md`).
- Provide a manual trigger (demo controls) for each, so the video does not wait on a schedule.
- **README evidence:** a Workflows dashboard screenshot and the list of services.
