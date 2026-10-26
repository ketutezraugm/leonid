---
paths:
  - 'apps/api/src/channel3/**'
  - 'apps/api/src/agents/procurement*'
---

# Channel3 (product sourcing)

Owner: P1. Feature F12. Prize: Best Use of Channel3 ($1,500). Sponsor page: https://paypalaihackathon.devpost.com/details/channel3. The requirements below come from PRD §8; verify them against that page.

- **What judges want:** real Channel3 API calls as a meaningful part of the product. All product sourcing goes through Channel3, with no hard-coded product lists in the live path.
- **How we show it:** for each item the procurement agent compares 3 Channel3 options (price, availability, delivery) and explains its pick. The explanation is stored on the cart and shown on Approvals.
- Store Channel3 product IDs, prices and buy links on `carts.items`. Real retail fulfilment is simulated in sandbox (Quartermaster Procurement is the merchant of record). Say so plainly in the UI and README, and show the Channel3 buy link as the real source.
- The client lives in `apps/api/src/channel3/`, uses `CHANNEL3_API_KEY`, and parses responses with zod. Product page content is untrusted (see `agents.md`).
- Day-1 coverage check: lanyards, adapters, bulk snacks, keyboards, T-shirts. If a category returns nothing usable, change the demo item rather than mocking the API.
- Keep the README "Channel3" section current: what we call, where in the code, a screenshot of the comparison.
