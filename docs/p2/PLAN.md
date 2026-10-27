# P2 plan: Ezra (PayPal buy side + infra), team NI AI WO

## Status update (Oct 27 night): read this first

Written for teammates and their coding agents. Never put secrets in these docs.

**Done and verified in the PayPal sandbox** (details in `RESULTS.md`):
- Two Merchant apps exist, Treasury and Procurement. Treasury: invoicing, payouts and balances work. Procurement: Vault v3 works.
- Vault flow end to end: payer approves a setup token, we create a payment token, a charge with `vault_id` and no buyer present returns COMPLETED (F13), and deleting the token makes the next charge fail with 403 from PayPal immediately (F15).
- Gotcha: on the first Procurement app, "Save payment methods" never took effect (no Vault scope in the token, 403 on setup-tokens). Recreating the app and ticking it right after creation fixed it.
- Treasury balance is $0.00, so a payout from Treasury fails until a sponsor invoice is paid.

**Code on local/pushed branches, no PR yet** (all off `development`, one topic each):
- `p2/db-setup`: Docker Postgres 18 (`pnpm db:up`), Drizzle config, `db:generate` / `db:migrate` / `db:seed`, schema skeleton (`events`, `webhook_events`, RLS on), `render.yaml` without Render Postgres. **Not to be merged until Harfi and I agree on one DB setup**, because Harfi is setting up the database on Supabase.
- `p2/paypal-core`: `apps/api/src/paypal/core.ts`, a client per PayPal app with token caching, `PayPal-Request-Id` on every POST, cents conversion and `PayPalError` with the debug id.
- `p2/docs`: this folder.

**Changes to the plan below:**
- The deployed database is **Supabase** (Harfi), not Render Postgres. Local dev can use Docker Postgres. Supabase free projects pause after about 7 days of inactivity, so someone must keep it alive until Dec 21. Tables must have Row Level Security on, since only our server should reach them. Render needs the pooler connection string.
- Budget: no Render Postgres cost.
- Docs are pushed (this branch) because Harfi, the integrator, asked for it.

## Context

Quartermaster (PayPal AI Hackathon) is still only a scaffold. It has an Express 5 API with `/api/health`, a React shell with 7 placeholder pages, `@quartermaster/shared` with `HealthResponse`, and `render.yaml`.

Roles:
- **P1 Harfi:** agent brain, and also the integration developer who merges `development` → `main`.
- **P2 Ezra:** this plan.
- **P3 Jose**
- **P4 Abel**

The PRD feature split stays as it is. I help Harfi if I finish early.

Ezra asked for a complete P2 plan: phases, gates, a day-by-day timeline that fits the other three roles, models, budget and verified research. Then we start building.

## Ground rules (agreed with Ezra)

- **Plan docs live in `docs/p2/` on branch `p2/docs`** so teammates and their agents can see progress (Harfi asked, Oct 27). They never contain secrets.
- **Code:**
  - Branches are `p2/<topic>`, created off `development`.
  - Small PRs go into `development`. Harfi promotes `development` → `main`, which auto-deploys to Render.
  - I commit locally and ask before every push or PR.
- **Commit authorship:** Ezra's account only. No `Co-Authored-By` trailer and no Claude attribution in commits or PR bodies. Git is already set to `user.email=ezradarkwing@gmail.com`, which maps to GitHub `ketutezraugm` (verified via commit search), so I make plain commits with no trailers and no author override.
- **Ownership (mine):**
  - The PayPal developer account: both sandbox apps and all sandbox accounts, every account set to **US** because Vault is US-only.
  - The Render workspace: the $50 credits are already redeemed. Harfi grants repo access.
  - The **database layer**: Drizzle schema for every table, migrations, Docker Postgres and the seed.
- **PayPal clients:** our own typed clients, built with the APIMatic Context Plugin. Agents are never given `@paypal/agent-toolkit` tools.
- **Hosted demo login:** real Log in with PayPal (sandbox credentials listed in the README) **plus** a rate-limited "Enter demo as treasurer" button.
- **Models:** Harfi owns them. OpenAI "Luna" for the hosted demo and video, Gemini free tier for dev and tests. P2 spends $0 on LLMs.
- **Schedule:** Gate 1 stays **Wed Oct 28**. Standup time is TBD. Ezra has about 20 h/week with no blocked days.
- **No tunnel:** PayPal login and real webhooks are tested only on Render.
- **Secrets:** they never go in chat. Ezra fills the gitignored `paypal-hack/.env`.

## Collaboration workflow (pulling teammates' code, PRs, syncing)

Repo facts: there is no CI, and `development` has no branch protection (`main` returned 404, so probably none either). All merge styles are enabled. Collaborators: Harfi (`harfiibadurahman01-del`), me (`ketutezraugm`), `ChristianoJ21`, `rafaelaanabelpurba`, `SyuraMoons`. Mapping the last three to people is skipped for now. Decisions: **1 approval + checks passing**, **no CI** (checks run locally), Discord/WhatsApp for chat, and secrets in a private pinned note, never on GitHub.

**Branch model**
- `main`: demo, auto-deploys to Render prod. Only Harfi promotes `development` → `main`, at gates or when the integration run passes.
- `development`: integration branch, auto-deploys to Render staging. Nobody commits to it directly.
- `p2/<topic>`: my short-lived branches off `development`, one feature each, kept to about a day of work. Teammates use their own prefixes (`p1/…`, `p3/…`, `p4/…`).

**Pulling teammates' work (every day, before standup and before opening a PR)**
1. `git fetch origin`
2. `git rebase origin/development` on my branch. It's my branch only, so rebasing is safe; then `git push --force-with-lease`.
3. `pnpm install`, `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, then `pnpm typecheck && pnpm lint && pnpm test`.
4. To try a teammate's unmerged branch: `git switch -c review/<branch> origin/<branch>` (or `gh pr checkout <n>`), run it, then switch back.

**PR rules (into `development`)**
- Small PRs.
- The title names the feature IDs (e.g. `feat(api): F13 vault auto-pay [P2]`).
- The body lists what changed, how it was tested, and the **pasted output of `pnpm typecheck && pnpm lint && pnpm test`** (the "green" check, since there's no CI).
- The author's GitHub account is the only author: no co-author or Claude trailers.
- 1 approval from any teammate. **Squash merge** by Harfi, who then deletes the branch.
- Shared-contract PRs (`packages/shared`) need approval from the owner whose endpoint they touch. DB-schema PRs need **my** approval.
- `main` must never break the demo. If `development` is red, fixing it comes before new work.

**Conflict hot spots and rules**
- **`packages/shared`:** additive changes only (new schemas or optional fields). Announce in chat before merging. Breaking a field needs agreement from everyone who uses it.
- **DB schema and migrations (I own them):**
  - Teammates edit `apps/api/src/db/schema.ts` in their PR (or ask me), but **only I run `drizzle-kit generate`**, after rebasing, so the migration journal never forks.
  - If two PRs both need migrations, the later one regenerates after rebasing.
  - Seed changes go through me as well.
- **`pnpm-lock.yaml`:** never hand-merge it. Take `development`'s version, rerun `pnpm install`, and commit the result.
- **`apps/api/src/app.ts` route mounting:** each owner mounts one router line, so conflicts stay one line wide.
- **Webhook handlers:** Jose and Abel add handlers through `registerHandler` in their own files, never by editing my dispatcher.
- **`.env.example`:** append only. When adding a variable, post its name in chat; values go in the private note.

**Communication**
- Daily standup (time TBD) covers blockers, what merged and what each person is pulling.
- Post when a PR merges that others depend on: contracts, schema, PayPal client core, webhook dispatcher.
- Each owner publishes the handoffs listed in `CONTRACTS.md` by its due date.
- Sandbox credentials, Render invites and the sandbox logins go in a private pinned note, never in git, PRs or issues.

## Step 0: connect tools + install skills (user scope, nothing in the repo)

Already OK:
- `gh`: authed as `ketutezraugm`, with push access (not admin).
- Git, Node 24, pnpm 11.
- Docker is installed, but **Ezra must start Docker Desktop**.

Installs:
1. `claude plugin install paypal@claude-plugins-official`
   - Adds the `paypal-best-practices` skill, a v5/v6 SDK guard hook and the `/paypal:*` commands.
   - Its sandbox MCP needs `PAYPAL_SANDBOX_ACCESS_TOKEN` (8h tokens), so it's optional. I mostly call the sandbox from scripts that read `.env`.
2. `claude plugin marketplace add render-oss/render-plugin-claude-code`, then `claude plugin install render`. Adds skills, the `render-assistant` agent, a `render.yaml` validation hook and the Render MCP (OAuth).
3. Render CLI v2.32.0 (`cli_2.32.0_windows_amd64.zip`) installed into `~/.local/bin`.
   - **Ezra runs `! render login`** and authorizes the Render MCP via `/mcp`.
   - Verify with `render whoami -o json`.
4. `npx context-plugins install paypal` (APIMatic, needed for the prize), then `/reload-plugins`.
5. `claude plugin install context7@claude-plugins-official`, for current docs on AI SDK 7, Drizzle, Express 5 and react-paypal-js v6.
6. `claude plugin install typescript-lsp@claude-plugins-official`, plus `typescript-language-server` globally if the plugin asks for it.
7. `claude plugin install playwright@claude-plugins-official`, plus `npx playwright install chromium` if needed.
8. `claude plugin install security-guidance@claude-plugins-official`. It's noisy, so I'll remove it if it slows work. I report blocking hooks instead of bypassing them.

Credentials in `.env` (I add the keys with empty values to `.env.example`, minus the sandbox logins):
- `PAYPAL_TREASURY_CLIENT_ID/SECRET` and `PAYPAL_PROCUREMENT_CLIENT_ID/SECRET`
- `PAYPAL_TREASURY_WEBHOOK_ID` and `PAYPAL_PROCUREMENT_WEBHOOK_ID`
- `SANDBOX_TREASURER_EMAIL/PASSWORD`, `SANDBOX_SPONSOR_{1,2,3}_EMAIL/PASSWORD` and `SANDBOX_VOLUNTEER_EMAIL/PASSWORD`, for Playwright on sandbox only

Smoke check: request a client-credentials token per app and print only its scopes. Confirm the Vault and Transaction Search (balances) scopes are there.

## Deliverable docs (`docs/p2/`, branch `p2/docs`)

1. `PLAN.md`: scope, architecture of my pieces, phases/gates, day-by-day timeline, dependency matrix, **collaboration workflow** (section above), env vars, budget, risks, testing, post-submission ops.
2. `DAY1-RUNBOOK.md`:
   - click-by-click PayPal dashboard setup (2 apps, features, US sandbox accounts)
   - day-1 tests with exact request bodies
   - Render setup
3. `CONTRACTS.md`: interfaces agreed with Harfi, Jose and Abel, with names, shapes, owners and due dates.
4. `RESEARCH.md`: verified facts, versions and prices, each with a source link.

## Verified research (Oct 27)

**PayPal SDK and tooling**
- **PayPal Server SDK:** `@paypal/paypal-server-sdk` 2.5.0 covers Orders, Payments, Vault (US only), Transaction Search and Subscriptions.
  - VaultController: `createSetupToken`, `createPaymentToken`, `getPaymentToken`, `listCustomerPaymentTokens`, `deletePaymentToken`.
  - Not covered: Identity, Invoicing, Payouts and webhook verify. Those get thin `fetch` wrappers.
- **APIMatic:** install with `npx context-plugins install paypal`. PayPal is already enabled. Participants get 1 month of Basic and winners get 6 months of Business (claim form).
- **`@paypal/agent-toolkit` 1.11.0:** depends on `ai@^4`/`zod@^3`, has no Payouts or Vault, and exposes `pay_order`/`create_refund`, which would bypass the rules engine. Not used for agents; at most an MCP server for the F24 stretch.

**Vault and kill switch**
- **Vault flow:**
  1. `POST /v3/vault/setup-tokens` with `payment_source.paypal` (`usage_type: MERCHANT`, `experience_context.return_url/cancel_url`).
  2. The payer approves.
  3. `POST /v3/vault/payment-tokens` with `{token:{id,type:"SETUP_TOKEN"}}`.
  4. Store the payment token id and `customer.id`.
  5. Charge with `POST /v2/checkout/orders`, `payment_source.paypal.vault_id`, which returns COMPLETED.

  Setup tokens expire in 3 days. Vault must be enabled on the app. Business account as payer is unconfirmed (day-1 test).
- **Kill switch:**
  - `DELETE /v3/vault/payment-tokens/{id}`. Because `VAULT.PAYMENT-TOKEN.DELETION-INITIATED` exists, deletion may be async, so day-1 test a charge immediately after DELETE.
  - The executor flips `agent_wallet.status=revoked` at once; PayPal's refusal is the demo proof.
  - Hosted demo: a pre-vaulted **token pool** (`permit_multiple_payment_tokens: true`). "Reset demo" activates the next pooled token, and the team refills the pool.

**Webhooks**
- All 10 PRD event names are verified to exist.
- `INVOICING.INVOICE.PAID` also fires for partial or pending payments. Contract for Jose: unlock only when the invoice is fully PAID.
- Verification:
  - Postback to `/v1/notifications/verify-webhook-signature` needs the **exact raw body**, so the route uses `express.raw()` mounted before `express.json()`.
  - Simulator events have the id `WEBHOOK_ID` and can't use postback, so they go through the self-verify path (CRC32 + cert).
- PayPal retries 25× over 3 days, so handlers are idempotent on the event id.
- Two apps means **two webhook IDs**. Routes: `/api/webhooks/paypal/treasury` and `/api/webhooks/paypal/procurement`.

**Log in with PayPal and F2 balance**
- **Login:**
  - Enabled on the Treasury app. It needs a **public HTTPS** return URL with an exact match; localhost doesn't work.
  - Scopes: openid, email, `https://uri.paypal.com/services/paypalattributes` (payer ID and verification status).
  - Authorize at `https://www.sandbox.paypal.com/connect?…response_type=code`, then exchange via `/v1/oauth2/token` with `grant_type=authorization_code`.
  - Userinfo: test both `/v1/identity/oauth2/userinfo?schema=paypalv1.1` and `/v1/identity/openidconnect/userinfo?schema=openid`.
- **F2 balance:** `GET /v1/reporting/balances` needs the `reporting/balances/read` scope and lags up to 3h. Live numbers come from the ledger; the PayPal balance is shown as "reconciled".

**Frontend, database and Render**
- **JS SDK:** `@paypal/react-paypal-js` 10.6.1 with `/sdk-v6` (`PayPalProvider environment="sandbox"` + `PayPalOneTimePaymentButton`, `createOrder → {orderId}`). Fallback: v5 `PayPalButtons`. Client IDs come from `/api/config` (public).
- **DB:** Drizzle 0.45.4 and drizzle-kit 0.31.11 with the `pg` driver. Docker runs `postgres:18`, matching Render's default.
- **Render:**
  - `@renderinc/sdk` 1.5.0 is GA.
    - Tasks: `task` from `@renderinc/sdk/workflows`. They auto-start on Render; locally they run with `render workflows dev -- <cmd>`.
    - Triggering: `new Render().workflows.startTask('wf/task', [args], {idempotencyKey})`.
    - Pricing: $0.20/CPU-h flex.
  - Blueprint `type: workflow` needs node + region and takes no `plan`. There is no native cron, so a `type: cron` service triggers runs.
  - Prices: web `0.5c-512mb` is about $7/mo; Postgres `0.1c-256mb` is about $6/mo plus $0.30/GB storage. Free web sleeps after 15 min; free Postgres expires after 30 days.
  - Whether the old `starter`/`basic-256mb` names still work is unverified, so I switch to the current IDs and validate.

**Perks and dates**
- **Sponsor perks:**
  - Render: $50 credits, already redeemed. Ezra checks the expiry in Billing and sets an alert.
  - Channel3: 20,000 credits with `PAYPAL-HACKATHON-2026`.
  - AG Studio and Bryntum: 45-day trials (expire about Dec 11, before winners on Dec 21). Ask the sponsors for an extension.
  - Postman: the PayPal collection is useful for day-1 manual tests.
- **Dates:** submissions close Nov 12 at 12:00 PST, and winners are announced Dec 21, so the hosted demo must live until Dec 21.

## Architecture of my pieces

- **`apps/api/src/db/`:**
  - Drizzle schema for all PRD §9 tables plus `users`, `sessions`, `webhook_events`, `approvals`, `demo_token_pool`.
  - Migrations and `seed.ts` (OpenHack 2027: 200 people, Mar 14 2027, $8,000, 3 sponsors).
  - `docker-compose.yml` and the scripts `db:up`, `db:migrate`, `db:seed`.
  - The audit-log *table* is mine; Harfi owns the F23 writer logic.
- **`apps/api/src/paypal/`:**
  - `core.ts`: per-app OAuth token cache, `PayPal-Request-Id` derived from our record IDs, cents ↔ `{currency_code,value}` conversion, zod parsing, `debug_id` logging.
  - `treasury.ts` and `procurement.ts`.
  - Money-moving functions are importable only by the executor.
- **`apps/api/src/payments/executor.ts`:**
  - Runs only after Harfi's `check()` returns allow, or after a recorded treasurer approval.
  - Writes the audit row before the PayPal call and adds the PayPal ID after.
  - Coded against `check()`'s shared type. Until Harfi's lands, a stub on my branch returns `needs_approval` above $200.
- **`apps/api/src/webhooks/`:**
  - One raw-body route per app: verify, store in `webhook_events`, then dispatch via `registerHandler(eventType, fn)`. Jose and Abel register their handlers.
  - `PAYPAL_WEBHOOK_VERIFY=false` is allowed locally only; the server refuses to boot with it when `NODE_ENV=production`.
  - `pnpm webhook:replay` posts fixture events.
- **`apps/api/src/auth/`:** PayPal login plus demo login, with a cookie session stored in Postgres.
- **`apps/workflows/`:** Render tasks that call `POST /api/internal/jobs/:name` (shared-secret header), so the logic stays in the API.
- **Web:**
  - `apps/web/src/approvals/` and `pages/Approvals.tsx`: PayPal button plus the agent's reasoning.
  - Event home: wallet and kill-switch card.
  - Public ticket and donation page.
- **Render services:**
  - **prod:** paid web on `main` plus paid Postgres.
  - **staging:** free web on `development` plus free Postgres, deleted after submission.
  - The workflow service and a cron service.
  - Day 1: check whether the PayPal app accepts multiple Return URLs. If not, use staging until Nov 8, then prod.
- **New env vars:**
  - `PAYPAL_TREASURY_WEBHOOK_ID` and `PAYPAL_PROCUREMENT_WEBHOOK_ID` (these replace the single `PAYPAL_WEBHOOK_ID`)
  - `SESSION_SECRET`, `APP_BASE_URL`, `INTERNAL_JOBS_SECRET`, `RENDER_API_KEY`, `DEMO_MODE`, `PAYPAL_WEBHOOK_VERIFY`

## Phases and gates (correct weekdays for 2026)

| Gate | Date | P2 must have |
| --- | --- | --- |
| G1 Setup | Wed Oct 28 | 2 apps + US sandbox accounts with features enabled; vault, business-as-payer and kill-switch results recorded; prod live from `main`; webhook listener receiving simulator events; Docker Postgres + Drizzle skeleton; APIMatic installed; creds shared privately with the team |
| G2 Core | Tue Nov 3 | F1, F2, F13, F14, F15 working on Render with Harfi's `check()`; seed runs; $140 auto-pays, $420 opens an approval, after the kill switch PayPal refuses the charge |
| G3 Upgrades | Sat Nov 7 | F6 tickets; Workflows with manual triggers (budget recompute, reminders, delivery check, payout batch); demo controls + token pool |
| Freeze | Sun Nov 8 | Bug fixes only; README P2/Render/APIMatic sections drafted; PayPal return URL on prod |
| Assets | Mon Nov 9 | Workflows screenshot, APIMatic prompts + screenshots, claim form sent, clips for Abel |
| Submit | Tue Nov 10 | Clean-browser judge run on the hosted URL |

If G1 slips, the Drizzle skeleton and the staging service can move to Oct 29. The day-1 PayPal tests and the prod deploy cannot.

## Day-by-day (P2 ↔ team)

- **Tue Oct 27:**
  - Me: Step 0. Ezra creates the 2 apps and US sandbox accounts, enables the features and fills `.env`. Docs written.
  - Harfi: Channel3 key + search test, agent skeleton, LLM module.
  - Jose: invoicing/payouts tests, AG Studio trial + boilerplate.
  - Abel: Bryntum trial, Gantt hello world, design tokens.
- **Wed Oct 28 (G1):**
  - Me: vault, business-as-payer and kill-switch tests; `p2/db-setup` (docker-compose, Drizzle skeleton, `.env.example`, `render.yaml` with current IDs + staging); prod deploy; webhook listener with both URLs registered.
  - Harfi: `check()` stub + its shared types.
  - Jose: Transaction Search test, first widget.
  - Abel: demo script locked, app shell.
- **Thu Oct 29:** full schema, migrations and seed. Shared-contract PR (session, wallet, approvals, treasury balance) handed to everyone.
- **Fri Oct 30:** PayPal client core + both clients via APIMatic, with prompts logged. Webhook verify + idempotency + dispatcher, and the vault handlers. Hand-off: Jose and Abel register their handlers.
- **Sat Oct 31:** F1 auth (PayPal + demo button) and F2 balance endpoint, plus the wallet card.
- **Sun Nov 1:** F13 wallet connect + executor auto-pay via the vault, wired to `check()`.
- **Mon Nov 2:** F14 approvals API + page with capture through the executor, plus the `CHECKOUT.ORDER.APPROVED` backup. F15 kill switch + token pool + reset.
- **Tue Nov 3 (G2):** integration run with Harfi on `development`, then promote to `main` and verify on Render.
- **Wed Nov 4:** `apps/workflows` + Blueprint workflow and cron + internal job endpoints + demo control buttons.
- **Thu Nov 5:** F6 tickets and donations (treasury Orders) written to the ledger.
- **Fri Nov 6:** hardening (rate limit, demo guard, error states), webhook simulator rehearsal, README sections.
- **Sat Nov 7 (G3):** upgrades on the hosted URL, then help Harfi.
- **Sun Nov 8 – Tue Nov 10:** freeze, assets, submit.
- **Nov 11 – Dec 21:** daily URL check, token-pool refill, credit balance check.

## Budget

- **Render:** prod web (~$7/mo) + Postgres (~$6/mo + storage) + Workflows/cron (cents) comes to about $27–32 through Dec 21. The $50 credits cover it, so P2 spends **$0 cash**. Set an alert at $35.
- **Free:** staging, APIMatic, Postman, Channel3.
- **LLM:** within the $20 cap, owned by Harfi.

## Testing

- **Unit tests:**
  - injected fake PayPal client
  - webhook verification against raw fixture bodies
  - executor: allow → charge, needs_approval → no charge, revoked → refused
  - idempotent replays
- **Manual sandbox smoke:** `pnpm --filter @quartermaster/api smoke:paypal`, never part of `pnpm test`.
- **Browser flows:** Playwright drives Log in with PayPal and the approval popups on staging, using the sandbox logins in `.env`.
- **Before every push:** `pnpm typecheck && pnpm lint && pnpm test`.

## Verification of this step

- The docs exist under `docs/p2/` on branch `p2/docs`.
- Plugins appear in `claude plugin list`, and `render whoami` succeeds.
- The token smoke check prints the expected scopes.
- On `p2/db-setup`: `docker compose up -d`, `pnpm db:migrate` and `pnpm db:seed` succeed, and typecheck, lint and test pass. Commits carry no co-author trailer. I push only after Ezra says so.
