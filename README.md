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

| Capability                                        | Code                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OAuth client credentials (per app, cached token)  | [`apps/api/src/paypal/client.ts`](apps/api/src/paypal/client.ts)                                                                                                                           |
| Orders v2: create order, show order               | [`apps/api/src/paypal/orders.ts`](apps/api/src/paypal/orders.ts)                                                                                                                           |
| Sandbox negative testing (`PayPal-Mock-Response`) | [`apps/api/src/paypal/client.ts`](apps/api/src/paypal/client.ts), [`apps/api/scripts/paypal-smoke.ts`](apps/api/scripts/paypal-smoke.ts) (`pnpm --filter @quartermaster/api paypal:smoke`) |

## Sponsor integrations

### AG Studio

_TODO (P3)_

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
