---
paths:
  - 'apps/web/src/money/**'
  - 'apps/web/src/pages/Money.tsx'
  - 'apps/api/src/agents/dashboard*'
---

# AG Studio (Money command center)

Owner: P3. Features F20 command center (Core) and F21 dashboard agent (Upgrade). Prize: Best Use of AG Grid ($5,000 / $2,000 / 3 × $1,000). Sponsor page: https://paypalaihackathon.devpost.com/details/aggrid. The requirements below come from PRD §8; verify package names, licence handling and boilerplate against that page.

- **What judges want:** polish (custom widgets, theming, layout) and the Studio Agent Framework, meaning a custom agent that talks to Studio's built-in agents.
- **Start from** the official PayPal + AG Studio hackathon boilerplate instead of from scratch.
- **Widgets** (PRD §8), all themed with our design tokens and cross-filtering each other:
  - Funding thermometer (custom): pledged vs invoiced vs cleared, per sponsor.
  - Budget burn (custom): spend vs unlocked budget by category, days to event.
  - Payouts ledger (grid): claims, speaker payments and prizes with status.
  - Rules health (custom): allowed, sent to approval and blocked, with reasons.
  - Delivery risk (custom): items whose expected arrival is after their deadline.
- **Dashboard agent demo beat:** asked "Where are we overspending?" or "spend by sponsor", it builds a new widget live. It is read-only and may never call spend or payout tools.
- **Data source:** API endpoints backed by our ledger (updated by webhooks), not direct PayPal calls from the browser.
- Keep the trial licence key out of git unless the sponsor confirms on Discord that a public key is fine. Read it from a Vite env var (`VITE_…`).
- Keep the README "AG Studio" section current, with screenshots of each widget.
