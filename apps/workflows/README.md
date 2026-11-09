# Render Workflows (P2)

Durable background jobs for Leonid, run by [Render Workflows](https://render.com/docs/workflows) (beta). A task only
orchestrates: steps, retries, parallel subtasks. The work happens in the API's own job endpoints (`apps/api/src/routes/jobs.ts`),
so the rules engine, the audit log and the ledger stay in one place and a task never holds PayPal credentials.

| Task | What it does | API behind it |
| --- | --- | --- |
| `budget-recompute` | Lists the events, then runs `recompute-event` for each one in parallel | `GET /api/jobs/events` |
| `recompute-event` | Retried 3 times. Cleared income minus committed spend for one event, written to the audit log | `POST /api/jobs/budget-recompute` |

Not built yet (PRD §9): invoice reminders, delivery check, payout batch, sponsor report.

## Start one by hand (the demo control)

A treasurer calls `POST /api/workflows/budget-recompute/run` and gets `{ runId }`; `GET /api/workflows/runs/:runId` says how it is going.

## Deploy (Render Dashboard, once)

Blueprints (`render.yaml`) do not support Workflows yet, so this is created by hand: **New > Workflow**.

| Field | Value |
| --- | --- |
| Repository / branch | this repo, `development` for staging |
| Root Directory | leave empty (the repo root) |
| Build Command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @quartermaster/workflows build` |
| Start Command | `node apps/workflows/dist/main.js` |
| Environment | `API_BASE_URL` (the API's URL, no trailing slash) and `JOBS_TOKEN` |

Then on the API service add `JOBS_TOKEN` (the same value), `RENDER_API_KEY` and `WORKFLOW_SLUG` (the Workflow service's slug).
Task names are `{slug}/budget-recompute` and `{slug}/recompute-event`.

## Run it locally

```sh
pnpm --filter @quartermaster/workflows build
render workflows dev -- node apps/workflows/dist/main.js    # Render CLI 2.11+, local task server on :8120
render workflows tasks list --local
```

Set `API_BASE_URL` and `JOBS_TOKEN` in the shell that starts it.
