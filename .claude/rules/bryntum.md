---
paths:
  - 'apps/web/src/plan/**'
  - 'apps/web/src/pages/Plan.tsx'
  - 'apps/api/src/agents/planning*'
---

# Bryntum Gantt and Calendar (event plan)

Owner: P4 (UI), P1 (planning agent). Features F11, F18 and F19. Prize: Best Use of Bryntum (3 × $1,000). Sponsor page: https://paypalaihackathon.devpost.com/details/bryntum. The requirements below come from PRD §8. Package install was checked against that page on Oct 27, 2026: it uses the same public `npm:@bryntum/<product>-trial` alias. Still open: whether the npm trial keeps working past 45 days, through judging (ask on the PayPal Discord).

- **What judges want:** their own example, in which a late PayPal payment visibly blocks the next phase, plus an agent that drives the schedule. Their "agent-driven rescheduler" idea (an agent watches PayPal payment events and moves or flags milestones when a payment fails, arrives late or is refunded) maps to our webhook-driven plan updates and F19.
- **Gantt and Calendar must both be the thin packages.** If the Gantt comes back next to the Calendar, they are in one single-page app, and Bryntum's regular bundles throw "The Bryntum Grid bundle was loaded multiple times" as soon as two products load in the same page, for example when you go from Home to Plan. Never add the regular `@bryntum/gantt` or `@bryntum/calendar` packages.
- The trials are public on npm, so no registry login or `.npmrc` is needed. `apps/web` installs them under aliases, all pinned to the same version (7.3.7): `"@bryntum/core-thin": "npm:@bryntum/core-thin-trial@7.3.7"`, and the same for `engine-thin`, `grid-thin`, `scheduler-thin`, `schedulerpro-thin`, `gantt-thin` and `calendar-thin`, next to the unaliased wrappers `@bryntum/core-react-thin`, `@bryntum/gantt-react-thin` and `@bryntum/calendar-react-thin`. Always import from the plain `-thin` names. Switching to a licence later means changing only the aliases. The postinstall scripts of `core-thin-trial` and `core-trial-lib` are allow-listed in `pnpm-workspace.yaml` after review (they only stamp a trial ID into the package's own files). The trial build is unminified and watermarked; that is expected.
- **Thin packages register only the features they import.** `src/plan/PlanGantt.tsx` imports the scheduler's `TimeRanges` for the event-day line, or the page crashes with "Feature 'timeRanges' not available". When you turn on a new feature, check the console for that error first. CSS comes from `core-thin` (core, FontAwesome, one theme) plus each product's own stylesheet.
- **Decision, Nov 10: the Plan screen and Home show Bryntum Calendar only, no Gantt.** The PRD (§8) asks for a Bryntum Gantt with dependencies, so this departs from it: the calendar has no dependency arrows and cannot draw a late payment blocking the next phase, which is what the judges' example shows. The Gantt (`src/plan/PlanGantt.tsx`) is kept unreferenced so it can come back. The calendar is read-only and loaded lazily from `src/home/BryntumPlanCalendar.tsx`, through `src/home/PlanCalendarPanel.tsx`. Tasks reach it as wall-clock UTC strings (`src/home/planEvents.ts`), never with a zone, so clock times match the plan in any browser time zone. Sponsors carry over from the Gantt: an invoice task follows its sponsor's status, and a purchase's title says which sponsor funds it and whether they have paid. Its theme is `src/home/calendar-theme.css`. Never write a hand-built calendar in its place.
- Bryntum ships breaking changes, so check API shapes against `node_modules/@bryntum/gantt-thin/gantt.d.ts` and `node_modules/@bryntum/calendar-thin/calendar.d.ts` or the Bryntum docs, not memory. The Gantt theme is overridden in `src/plan/gantt-theme.css` from our tokens (`--b-primary` and friends).
- **Plan rules** (PRD §8):
  - Each sponsor invoice is a task. Purchases funded by that sponsor depend on it and stay blocked until `INVOICING.INVOICE.PAID`.
  - Expected delivery dates from PayPal tracking push the dependent tasks.
  - Event day is a fixed milestone. Any task pushed past its deadline turns red and alerts the organizer.
- The planning agent edits the plan through the same API a human uses (our task endpoints), so drag-and-drop edits and agent edits stay consistent. The agent never writes Bryntum state directly.
- **Demo goal:** "200-person hackathon on Mar 14" yields 15 or more linked tasks: venue deposit, swag with lead time, prizes, AV, catering, speaker travel.
- Keep the README "Bryntum" section current, with a screenshot of the invoice-gated cascade.
