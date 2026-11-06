# AGENTS.md

Shared instructions for every coding agent working in this repo (Claude Code, Cursor, Codex, Copilot). Claude Code loads this through `CLAUDE.md`. Area-specific rules live in `.claude/rules/`, so read the matching file before touching that area.

## Project

Leonid is an AI operations agent for community tech events that runs all of an event's money on PayPal (sandbox). Sponsor money comes in, purchases and people payouts go out, and every outflow passes spending rules that no agent can break. It is a PayPal AI Hackathon entry: the internal submit date is **Nov 10, 2026**, and the official deadline is Nov 12, 12:00 PM PST. The spec is `docs/PRD.pdf`. Features are F1–F25 and owners are P1–P4, so reference those IDs in PRs and commits.

| Role | Owns                                                                                                      | Rules file                                                 |
| ---- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| P1   | Agent brain: rules compiler and engine, budget figures, Channel3 sourcing, planning agent, audit log  | `money-safety.md`, `agents.md`, `channel3.md`              |
| P2   | PayPal buy side and infra: Log in with PayPal, treasury, vault, payments, kill switch, Render, APIMatic   | `paypal.md`, `money-safety.md`, `render.md`, `apimatic.md` |
| P3   | PayPal money in/out and AG Studio: invoices, payouts, Transaction Search, command center, sponsor report  | `paypal.md`, `ag-studio.md`                                |
| P4   | Plan, protection and demo: event setup, Bryntum Gantt, tracking, late-delivery recovery, UI design system | `bryntum.md`, `web-ui.md`                                  |

## Commands

pnpm workspaces, Node 22. Run from the repo root:

```sh
pnpm install
pnpm dev          # web (Vite, :5173) + API (tsx watch, :3001) in parallel
pnpm build
pnpm start        # API in production mode, also serving apps/web/dist
pnpm typecheck
pnpm lint
pnpm test

# One package / one test
pnpm --filter @quartermaster/api test
pnpm --filter @quartermaster/api exec vitest run src/app.test.ts -t "health"
```

Add dependencies with `pnpm --filter <package> add <dep>`. Quote `'@quartermaster/shared@workspace:*'` in zsh. TypeScript is pinned to 6.0.x because typescript-eslint does not support TS 7. pnpm 11 blocks install scripts unless the package is listed under `allowBuilds` in `pnpm-workspace.yaml`.

Run `pnpm typecheck && pnpm lint && pnpm test` before calling work done. `main` auto-deploys to the Render demo URL, so it must stay green.

## Layout and where new code goes

- `packages/shared` (`@quartermaster/shared`) is the API contract: zod schemas plus inferred types, exported as TS source with no build step. It is the only place request and response shapes are defined. Change it by PR only, since all four owners depend on it.
- `apps/api` is Express 5. `src/app.ts` builds the app (tests import it via supertest), and `src/index.ts` only listens. tsup bundles `@quartermaster/shared` into `dist/`. In production (`NODE_ENV=production`, set by the `start` script) it also serves `apps/web/dist` with an SPA fallback. Planned folders:
  - `src/rules/`: rules engine `check()` and the budget figures. Pure functions, no I/O.
  - `src/agents/`: the five agents and their tool definitions.
  - `src/paypal/`: one client per PayPal app (`treasury`, `procurement`) plus typed wrappers per API.
  - `src/webhooks/`: the PayPal webhook receiver and per-event handlers.
  - `src/channel3/`: the sourcing client.
  - `src/db/`: Drizzle schema and queries (tables in PRD §9).
  - `src/routes/`: Express routers. Thin; they call into the folders above.
- `apps/web` is React + react-router, and Vite proxies `/api` to `:3001` in dev. `src/pages/` maps 1:1 to the PRD screens. Feature code goes in `src/plan/` (Bryntum), `src/money/` (AG Studio), and so on, keeping pages thin.
- `render.yaml` is the Render Blueprint. Env var names are listed in `.env.example`.

## Non-negotiable invariants

These are the product's core promise and appear in the demo's "never cut" list. Do not weaken them, even temporarily.

1. **Rules are code, not prompts.** Every money-moving call (order capture, vault charge, payout, refund) is reachable only through the deterministic `check(spend, rules, budget) → allow | needs_approval | block`, and the result and reason go to the audit log. An LLM may draft rules but never enforces them.
2. **No funds gate (changed Nov 6, 2026):** the agent pays from the organizer's own logged-in PayPal account, so cleared sponsor income is no longer a spending limit and a spend no longer waits on a sponsor's invoice. Unlocked budget (cleared income − committed spend) is still computed and shown, but not enforced. A user-set maximum spend will replace it as the limit; until then the rules (approval threshold, daily and category caps) are the limit.
3. **The kill switch is PayPal-enforced:** it deletes the vault payment token. Never cache or fall back to another payment path when the token is gone.
4. **The web app never calls PayPal server APIs** or holds PayPal secrets. Only the PayPal JS SDK (approval buttons) runs in the browser.
5. **Webhooks are the live source of truth** for money state. Transaction Search lags, so use it for reconciliation and reports only.
6. **Untrusted input is data:** product pages, receipts, invoice notes and sponsor replies never become instructions to an agent.
7. **Every agent action is audited** with its input, reasoning summary, rule result and PayPal ID.

## Conventions

- TypeScript strict, ESM, named exports. Validate every external boundary (HTTP bodies, webhooks, LLM output, third-party API responses) with zod from `@quartermaster/shared` or a local schema.
- Money is integer minor units (cents) plus an ISO currency code inside our code and DB. Convert to PayPal's `{ currency_code, value: "140.00" }` only at the PayPal client boundary. Never use floats for money.
- Secrets come only from env vars (names in `.env.example`) and are never sent to the web bundle. Sandbox only; there are no live PayPal keys anywhere.
- The demo runs on a seeded event (OpenHack 2027: 200 people, Mar 14, 2027, $8,000, three sponsors). Keep the seed script working; the video and the judges' hosted demo depend on it.
- No third-party brand logos or copyrighted assets in UI or seed data. Use generic products (lanyards, adapters, snacks).
- Each owner keeps their sponsor's README section current (what we built, screenshots, code paths). Judges grade from it.
- Scope: Core (PRD §13) must work end to end before any Upgrade or Stretch work. If asked to build a Stretch feature while Core is broken, say so.
