# P3 Stage 2: F20 command center

Owner: P3. Source: PRD §8 (AG Studio widgets) and the Stage 2 plan. Reader: the team (P1, P2, P4) and P3.

**Status (2026-11-01): the Nov 3 gate, "four custom widgets work with cross-filtering", is met on sample data, checked in the real AG Studio.** What is not done is marked.

| Part of Stage 2 | State |
| --- | --- |
| Funding thermometer (custom) | Done and merged. Numbers are live, from the ledger. |
| Budget burn (custom) | Done. Numbers are **live**: cleared income from the ledger, committed spend exactly as the rules check counts it, caps from the rules in force. |
| Rules health (custom) | Done. Reads the audit log's `spend.check` rows, so it is live as soon as spends are checked. |
| Delivery risk (custom) | Done. Numbers are **sample** until P4's orders and tracking exist. |
| Payouts ledger (grid) | Done. Rows are **sample** until F17's payouts table exists. |
| Cross-filtering by sponsor and category | Done, across all of the above. See "How the filtering works". |
| Theme from tokens, currency symbol | Done. Money shows `$3,000.00`, and every colour is a token. |
| Endpoints in the shared shapes | Done: `GET /api/widgets/{funding, rules-health, budget-burn, delivery-risk, payouts}`. |
| The web reads the endpoints | Done, with a line above the widgets that says which numbers are live. |

## Branches

Stacked in this order, so each PR contains the ones above it. #50 carries all of them to `development`.

| Branch | What it adds |
| --- | --- |
| `p3/command-center-filters` (#51) | The relationships between tables, the event-level opt-out, the fan-out policy, the currency symbol |
| `p3/widgets-payouts-api` (#48) | The rules health widget, the hook that tells it the filters changed, plain-text days, the delivery risk widget, `GET /api/widgets/payouts`, and the endpoints taking an optional `eventId` |
| `p3/command-center-live-data` (#49) | The web reads the endpoints, labels the source, falls back |
| `p3/stage-2-docs` (#50) | This write-up |

Merged earlier: the live funding and rules-health endpoints (#36), the sample budget-burn and delivery-risk endpoints, and the funding thermometer and budget burn widgets (#41).

## How the filtering works

Studio connects two tables only through a relationship, and a relationship makes the connection work in **both** directions. That caused a real bug, found by running it:

- Sponsors and budget categories both relate to payouts, rule checks and deliveries. So a click on a sponsor also reached the category totals *through* the payouts: the "Spent and committed" tile changed to $420 when a sponsor was selected. A category total is not a sponsor's, and the join can inflate a sum (Studio logged a fan-out warning).
- The fix: the three KPI tiles, the funding thermometer and budget burn are **event-level**. They set `crossFilter: 'none'` and ignore other widgets' selections. Only the widgets that list individual rows (payouts, rules health, delivery risk) respond. A global fan-out policy of `prevent` refuses any query that would inflate a sum, so a widget built later, by hand or by the dashboard agent, gets an error instead of a quietly wrong number.
- Row widgets filter on the **budget category's** field, not their own table's category column. Filtering on a row table's column leaks up through the dimension tables to the others.

Studio does not tell a custom widget that another widget changed the filters. It does emit `stateUpdated`, so `CommandCenter` passes it to `apps/web/src/money/widgets/filters-changed.ts`, and a widget that lists rows fetches again when the filters change. Studio reports changes, not where it started, so the hook has to be told the starting state (`startFrom`); without that, the first click was taken for the baseline and changed nothing.

## Other things the real Studio taught us

- **Dates.** Studio returns a date as a `Date` at local midnight. Read in UTC, a check on 2027-01-14 showed as 2027-01-13 for anyone east of Greenwich. The widgets map a plain-text day column instead, and the tests run in three time zones.
- **A missing cap.** Studio sums a missing cap to zero, so a $0 cap cannot be told from no cap. Budget burn reads both as "no cap", because a false "over the cap" alarm is worse than a missed one.
- **Data mapping.** Hidden fields (`hide: true`) can be mapped into a custom widget, which is what lets a widget keep one row per check.
- **All or nothing.** The web asks all five endpoints, and if any fails it shows its own sample *as a whole* and says why. Live sponsor ids would not match sample rows, so a half-live page would silently break the cross-filtering.
- **The event id.** `useEvent()` returns `id: null` until the Event endpoint exists, so the widget endpoints take an optional `eventId` and default to the seeded demo event. A bad id is still a 400 and an unknown one a 404. The command center passes the current event's id to all five endpoints and reloads when the event changes. Rules health reads only the `spend.check` rows whose input carried that event's id; a check with no event id (from before spends carried one) is shown under the demo event only.

## What was checked, and how

Unit tests for each piece (web 263, API widget tests 71, shared 33), plus, in a real browser against the real AG Studio:

- every click (a sponsor, each category, a row in each widget) against the payouts grid, the rules list and the delivery list, with the event-level widgets unchanged by every click;
- the page with no API, with an API that answers 401, and with a signed-in API serving live-shaped data under new sponsor ids. The API in that last check was a throwaway stand-in, so the shared database was not touched.

## Not done, and why

- **Budget burn has no unlocked-budget or days-to-event figure.** PRD §8 lists them, but they are not in the categories table. The endpoint returns real `unlocked` and `daysToEvent` figures now; the widget needs a table for them before it can show them.
- **Rules health counts the latest 20 checks**, which is what the endpoint returns, not all-time counts. It has no event filter yet (`live.ts` is correct while there is one event).
- **There is no "spend by sponsor" view.** Event-level widgets deliberately ignore a sponsor selection, so that widget (F21's demo beat) needs a table of spend attributed to a sponsor first.
- **The Filters panel says "No filters available".** There are no filter widgets yet.
- **The AG Studio licence banner is still showing.** `VITE_AG_STUDIO_LICENSE` is empty, pending the sponsor's answer in `stage-0.md`.
- **The payouts ledger has no live data** until the payouts table exists (F17, Stage 3).

## Dependencies on other roles

| Who | What is needed | Why |
| --- | --- | --- |
| P1 | The rules table (F8) | Budget burn's caps come from the demo rules until then, as the rules check's do |
| P4 | The Event endpoint, so `useEvent()` has an id | The web can then pass an event id; it works without one for the demo event |
| P4 | Orders and tracking (F18) | Delivery risk is sample until then |
| P2 | Staging deployed from `development`, with a treasurer login | The widgets are treasurer-only, so a signed-out visitor sees the labelled sample |
| P3 | F17 payouts table and endpoint | The payouts ledger goes live |

## Known issues

- Running the whole API suite in parallel on one machine can time out some database tests that are not P3's (`db.test.ts`, `payments/db.test.ts`, `venueDeposit.test.ts` and others, 40 to 58 seconds each). They pass when run alone, and the widget tests pass either way.

## What is next for P3

F17 payouts first, then F16 receipt claims (Upgrade tier, due Nov 7), then the dashboard agent (F21), the sponsor report (F22) and reminders (F5). P4's "Sponsors and invoices" tab is also waiting on a sponsor-list endpoint from P3.
