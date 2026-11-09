# Demo video script (draft)

Owner: P4. Built from PRD §10, which locks on Oct 28. Target length is 2:50 and the hard cap is 3:00. Each beat lists what it needs from the product, so owners know which features the video depends on.

Record in the sandbox against the seeded event (OpenHack 2027: 200 people, Mar 14, 2027, $8,000, three sponsors). Capture at 1080p, record the voice-over separately, and burn in captions. Use no third-party logos or copyrighted music, and keep products generic (lanyards, adapters, snacks).

| Time      | Beat                  | On screen                                                                                                       | Voice-over (draft)                                                                                                     | Needs                          | Owner  |
| --------- | --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| 0:00–0:15 | Hook                  | Organizer paying for pizza on a personal card                                                                   | "Every hackathon organizer has paid for pizza out of their own pocket. Leonid makes sure no one has to again." | Stock-free footage or reenact  | P4     |
| 0:15–0:30 | Set up                | Sign in with PayPal; connect the treasury; OpenHack 2027 opens in the agent chat, Mar 14 countdown in the sidebar | "The treasurer signs in with PayPal and connects the event's own business account."                                   | F1, F2, F3                     | P2, P4 |
| 0:30–0:50 | Money in              | Agent drafts 3 sponsor invoices; switch to a sponsor sandbox account and pay one; the sponsor money received rises live    | "Sponsors get a PayPal invoice in seconds, and you see the moment their money lands."                                                  | F4, webhooks                  | P3, P1 |
| 0:50–1:05 | Rules                 | Treasurer types 3 rules; structured rules appear for confirmation                                               | "Rules are written in plain English and enforced in code. The AI drafts them, but it can't break them."               | F8                             | P1     |
| 1:05–1:30 | Plan                  | Goal typed; the Gantt builds itself; each purchase names the sponsor funding it; a sponsor pays and its invoice task turns done live | "One plan for the whole event: what gets bought, who funds it, and what has to arrive before event day."                                               | F11, Bryntum, `INVOICE.PAID`   | P1, P4 |
| 1:30–1:55 | Buy                   | Agent compares Channel3 options; a $140 lanyard cart from Lanyard Co, the approved seller, pays automatically; a $420 swag cart from a seller not on the approved list is blocked, and the reason shows ("… is not on the approved swag list") | "Carts inside your rules pay themselves. A cart that breaks one is blocked, and you see why."                    | F9, F12, F13                   | P1, P2 |
| 1:55–2:15 | Late swag             | Delivery check flags late lanyards; refund, re-sourced order, Gantt cascades, event day stays green            | "When the lanyards run late, the agent refunds, reorders and replans, and event day stays on track."                  | F18, F19, Render Workflows     | P4, P2 |
| 2:15–2:35 | Pay people and report | Claims: add a volunteer, open their link on a phone and snap a receipt, paid to PayPal; Money › Payouts: pay three winners, each with their country, and a prize over $200 is sent directly (no approval step); on Money, ask the dashboard agent "Where are we overspending?" and it adds a Spend vs Cap by Category chart       | "Volunteers, speakers and winners get paid in minutes, anywhere."                                                      | F16, F17, F20, F21             | P3     |
| 2:35–2:50 | Kill switch and close | Treasurer revokes the token; the agent tries to buy and is refused                                              | "Every guarantee in Leonid is a PayPal guarantee."                                                              | F15                            | P2     |

## Fallback shots

If an Upgrade feature is cut (PRD §13), the beat changes as follows:

- **Late swag (F18/F19) cut:** show the Gantt cascade by dragging the delivery date by hand, and skip the refund.
- **Receipt claims (F16) cut:** show only the prize payout batch.
- **Dashboard agent (F21) cut:** show the four custom widgets cross-filtering.
- **Dashboard agent timing:** it takes about 80 seconds to add the chart, so record the whole wait and speed it up in the edit, with a "sped up" caption. Record it in one take: a chart it adds is gone after a page reload.

The "never cut" shots must stay: an automatic payment next to one the rules block, with the reason shown; the Gantt the agent built from the goal; the kill switch; and the rules engine. The approval popup next to an automatic payment was dropped on Nov 9 with #115, when the approval step was removed; the blocked cart replaces it, using the seeded rules (Lanyard Co is the only approved swag seller). The sponsor-gate shot (a task unlocking when an invoice is paid) was dropped on Nov 6, when the sponsor gate was removed; late swag (F18/F19) is now the Gantt's moving moment.

## Open items

- [ ] Confirm the hook footage source (we film it ourselves, no stock with logos).
- [ ] Time each beat against a rough screen recording once Core works (Nov 3).
- [ ] Pick the voice-over speaker.
- [ ] Rules beat (0:50): it needs the rules compiler (F8, P1). Until it lands, the demo's rules are fixed in code (`apps/api/src/rules/demoRules.ts`), so confirm with P1 what to film here.
- [ ] Buy beat: confirm with P1 and P2 where the blocked cart's reason shows (the agent's reply, Money's rules health widget, or both), and that the seller name in the shot is generic.
