---
paths:
  - 'apps/web/src/plan/**'
  - 'apps/web/src/pages/Plan.tsx'
  - 'apps/api/src/agents/planning*'
---

# Bryntum Gantt (event plan)

Owner: P4 (UI), P1 (planning agent). Features F11, F18 and F19. Prize: Best Use of Bryntum (3 × $1,000). Sponsor page: https://paypalaihackathon.devpost.com/details/bryntum. The requirements below come from PRD §8. Package install was checked against that page on Oct 27, 2026: it uses the same public `npm:@bryntum/<product>-trial` alias. Still open: whether the npm trial keeps working past 45 days, through judging (ask on the PayPal Discord).

- **What judges want:** their own example, in which a late PayPal payment visibly blocks the next phase, plus an agent that drives the schedule. Their "agent-driven rescheduler" idea (an agent watches PayPal payment events and moves or flags milestones when a payment fails, arrives late or is refunded) maps to our webhook-driven plan updates and F19.
- The Gantt trial is public on npm, so no registry login or `.npmrc` is needed. `apps/web` installs it under an alias, `"@bryntum/gantt": "npm:@bryntum/gantt-trial@7.3.7"`, next to `@bryntum/gantt-react`. Always import from `@bryntum/gantt`. Switching to a licence later means changing only the alias. Trial postinstall scripts are allow-listed in `pnpm-workspace.yaml` after review (they only stamp a trial ID into the package's own files). The trial build is unminified and watermarked; that is expected.
- Bryntum ships breaking changes, so check API shapes against `node_modules/@bryntum/gantt/gantt.d.ts` or https://bryntum.com/products/gantt/docs, not memory. The theme is overridden in `src/plan/gantt-theme.css` from our tokens (`--b-primary` and friends).
- **Plan rules** (PRD §8):
  - Each sponsor invoice is a task. Purchases funded by that sponsor depend on it and stay blocked until `INVOICING.INVOICE.PAID`.
  - Expected delivery dates from PayPal tracking push the dependent tasks.
  - Event day is a fixed milestone. Any task pushed past its deadline turns red and alerts the organizer.
- The planning agent edits the plan through the same API a human uses (our task endpoints), so drag-and-drop edits and agent edits stay consistent. The agent never writes Bryntum state directly.
- **Demo goal:** "200-person hackathon on Mar 14" yields 15 or more linked tasks: venue deposit, swag with lead time, prizes, AV, catering, speaker travel.
- Keep the README "Bryntum" section current, with a screenshot of the invoice-gated cascade.
