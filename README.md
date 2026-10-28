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

The Money screen is an AG Studio command center, themed from `apps/web/src/styles/tokens.css`. Its data sources are built from the shared widget shapes (`packages/shared/src/widgets.ts`); for now they read sample data and will switch to ledger-backed API endpoints.

| What                                                        | Code                                   |
| ----------------------------------------------------------- | -------------------------------------- |
| Studio wiring, lazy-loaded                                  | `apps/web/src/money/CommandCenter.tsx` |
| Theme from design tokens                                    | `apps/web/src/money/studio-theme.ts`   |
| Data sources from the shared shapes                         | `apps/web/src/money/studio-data.ts`    |
| Default report (KPIs, funding, budget burn, payouts ledger) | `apps/web/src/money/initial-report.ts` |

![Money command center](docs/p3/screenshots/money-stage-0.png)

Setup notes and the day-1 PayPal checks: [`docs/p3/stage-0.md`](docs/p3/stage-0.md). The licence key is read from `VITE_AG_STUDIO_LICENSE` and is not committed.

### Bryntum

_TODO (P4)_

### Channel3

_TODO (P1)_

### Render

_TODO (P2)_

### APIMatic

_TODO (P2)_

## License

MIT
