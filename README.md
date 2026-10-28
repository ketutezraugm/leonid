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
| `render.yaml`     | Render Blueprint (web service + Postgres)              |

## PayPal capabilities used

_TODO: list each capability with a link to its code path._

## Sponsor integrations

### AG Studio

_TODO (P3)_

### Bryntum

The Plan screen is a Bryntum Gantt (trial 7.3.7, React wrapper) in [`apps/web/src/plan/`](apps/web/src/plan/). Each sponsor invoice is a task, and the purchases that sponsor funds depend on it, so they stay blocked until PayPal reports the invoice paid. Event day is a fixed milestone. Task colors and the Gantt theme come from the same design tokens as the rest of the app.

_Status: hello world on a static slice of the demo plan. Next: live tasks from the planning agent (F11), tracking dates (F18) and the late-delivery cascade (F19). Screenshot of the invoice-gated cascade to come._

### Channel3

_TODO (P1)_

### Render

_TODO (P2)_

### APIMatic

_TODO (P2)_

## License

MIT
