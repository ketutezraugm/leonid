---
paths:
  - 'apps/web/**'
---

# Web UI

Owner: P4 (design system), and each screen's feature owner.

- **Judging cares about Design:** one polished app, not a proof of concept. Plan, dashboard, approvals and reports share one design system. Use tokens from `src/styles/tokens.css` and never hard-code colors or spacing. AG Studio and Bryntum themes must also be driven from these tokens.
- **Screens** (PRD §4):
  - Event home: countdown, unlocked budget, alerts, with the agent chat in a drawer on every screen.
  - Agent (`/agent`): the chat rail and the results canvas, where venue results and the deposit live.
  - Plan (Bryntum).
  - Money (AG Studio).
  - Approvals: PayPal JS SDK buttons and the agent's reasoning.
  - Rules: plain English next to the structured version.
  - Claims: must be mobile-friendly, because volunteers snap receipts on a phone.
  - Sponsor report: public and shareable at `/report/:sponsorId`.
- The browser talks only to our `/api`. The PayPal JS SDK (client ID only) is the one PayPal surface allowed in the web app.
- Request and response types come from `@quartermaster/shared`. Parse API responses with its zod schemas.
- Money displays come from integer cents through one shared formatter.
- No third-party logos or copyrighted assets, because the demo video must avoid trademarks.
