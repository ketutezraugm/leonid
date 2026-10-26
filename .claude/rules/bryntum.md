---
paths:
  - 'apps/web/src/plan/**'
  - 'apps/web/src/pages/Plan.tsx'
  - 'apps/api/src/agents/planning*'
---

# Bryntum Gantt (event plan)

Owner: P4 (UI), P1 (planning agent). Features F11, F18 and F19. Prize: Best Use of Bryntum (3 × $1,000). Sponsor page: https://paypalaihackathon.devpost.com/details/bryntum. The requirements below come from PRD §8; verify package names and trial setup against that page.

- **What judges want:** their own example, in which a late PayPal payment visibly blocks the next phase, plus an agent that drives the schedule.
- Install the Bryntum Gantt trial and the React wrapper from Bryntum's private npm registry. The registry config goes in `.npmrc` with credentials from env, never committed. Until P4 has trial access, `Plan.tsx` stays a placeholder so `pnpm install` works for everyone.
- **Plan rules** (PRD §8):
  - Each sponsor invoice is a task. Purchases funded by that sponsor depend on it and stay blocked until `INVOICING.INVOICE.PAID`.
  - Expected delivery dates from PayPal tracking push the dependent tasks.
  - Event day is a fixed milestone. Any task pushed past its deadline turns red and alerts the organizer.
- The planning agent edits the plan through the same API a human uses (our task endpoints), so drag-and-drop edits and agent edits stay consistent. The agent never writes Bryntum state directly.
- **Demo goal:** "200-person hackathon on Mar 14" yields 15 or more linked tasks: venue deposit, swag with lead time, prizes, AV, catering, speaker travel.
- Keep the README "Bryntum" section current, with a screenshot of the invoice-gated cascade.
