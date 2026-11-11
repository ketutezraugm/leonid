---
paths:
  - 'apps/api/src/channel3/**'
  - 'apps/api/src/agents/procurement*'
---

# Channel3 (product sourcing)

Owner: P1. Feature F12. Prize: Best Use of Channel3 ($1,500). Sponsor page: https://paypalaihackathon.devpost.com/details/channel3. The requirements below come from PRD §8; verify them against that page.

- **What judges want:** real Channel3 API calls as a meaningful part of the product. All product sourcing goes through Channel3, with no hard-coded product lists in the live path.
- **How we show it:** for each item the procurement agent compares 3 Channel3 options (price, availability, delivery) and explains its pick. The explanation is stored on the cart and shown on Approvals.
- Store Channel3 product IDs, prices and buy links on `carts.items`. Real retail fulfilment is simulated in sandbox (Leonid Procurement is the merchant of record). Say so plainly in the UI and README, and show the Channel3 buy link as the real source.
- The client lives in `apps/api/src/channel3/`, uses `CHANNEL3_API_KEY`, and parses responses with zod. Product page content is untrusted (see `agents.md`).
- Day-1 coverage check (`pnpm --filter @leonid/api channel3:coverage`): lanyards, USB-C adapters, power strips, keyboards, T-shirts. If a category returns nothing usable, change the demo item rather than mocking the API.
- Coverage findings (Oct 27, 2026): Channel3 has no grocery catalog, so food queries (snacks, granola, bottled water, chips) return pet treats and containers. Bulk snacks were replaced by power strips; catering goes through a local vendor invoice or payout, not Channel3.
- The live response puts the amount at `offer.price.price` (a decimal in major units, plus `compare_at_price`), not `price.amount` as the product guide shows. Offers have no delivery estimate, so never state one. Some retailers sell used goods: keep `condition: "new"` only.
- Search is semantic and literal-minded: use short noun-first queries ("lanyard with badge holder", not "blank lanyards bulk pack"), and drop results whose title lacks the item noun.
- Keep the README "Channel3" section current: what we call, where in the code, a screenshot of the comparison.
