# Demo video script (draft)

Owner: P4. Built from PRD §10, which locks on Oct 28. Target length is 2:50 and the hard cap is 3:00. Each beat lists what it needs from the product, so owners know which features the video depends on.

Record in the sandbox against the seeded event (OpenHack 2027: 200 people, Mar 14, 2027, $8,000, three sponsors). Capture at 1080p, record the voice-over separately, and burn in captions. Use no third-party logos or copyrighted music, and keep products generic (lanyards, adapters, snacks).

| Time      | Beat                  | On screen                                                                                                       | Voice-over (draft)                                                                                                     | Needs                          | Owner  |
| --------- | --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| 0:00–0:15 | Hook                  | Organizer paying for pizza on a personal card                                                                   | "Every hackathon organizer has paid for pizza out of their own pocket. Quartermaster makes sure no one has to again." | Stock-free footage or reenact  | P4     |
| 0:15–0:30 | Set up                | Sign in with PayPal; connect the treasury; event home shows OpenHack 2027, 200 people, Mar 14, $8,000           | "The treasurer signs in with PayPal and connects the event's own business account."                                   | F1, F2, F3                     | P2, P4 |
| 0:30–0:50 | Money in              | Agent drafts 3 sponsor invoices; switch to a sponsor sandbox account and pay one; unlocked budget rises live    | "Sponsor money only becomes spendable once it has actually cleared."                                                  | F4, F10, webhooks              | P3, P1 |
| 0:50–1:05 | Rules                 | Treasurer types 3 rules; structured rules appear for confirmation                                               | "Rules are written in plain English and enforced in code. The AI drafts them, but it can't break them."               | F8                             | P1     |
| 1:05–1:30 | Plan                  | Goal typed; the Gantt builds itself; the swag task is blocked on a sponsor invoice, then unlocks when it's paid | "Purchases that need a sponsor's money wait for that sponsor's payment."                                               | F11, Bryntum, `INVOICE.PAID`   | P1, P4 |
| 1:30–1:55 | Buy                   | Agent compares Channel3 options; a $140 cart pays automatically; a $420 prize cart opens a PayPal approval      | "Small carts pay themselves. Anything over the limit comes to the treasurer as a PayPal approval."                    | F12, F13, F14                  | P1, P2 |
| 1:55–2:15 | Late swag             | Delivery check flags late lanyards; refund, re-sourced order, Gantt cascades, event day stays green            | "When the lanyards run late, the agent refunds, reorders and replans, and event day stays on track."                  | F18, F19, Render Workflows     | P4, P2 |
| 2:15–2:35 | Pay people and report | Volunteer receipt paid to PayPal; prize payouts to winners in 3 countries; dashboard agent builds a widget       | "Volunteers, speakers and winners get paid in minutes, anywhere."                                                      | F16, F17, F20, F21             | P3     |
| 2:35–2:50 | Kill switch and close | Treasurer revokes the token; the agent tries to buy and is refused                                              | "Every guarantee in Quartermaster is a PayPal guarantee."                                                              | F15                            | P2     |

## Fallback shots

If an Upgrade feature is cut (PRD §13), the beat changes as follows:

- **Late swag (F18/F19) cut:** show the Gantt cascade by dragging the delivery date by hand, and skip the refund.
- **Receipt claims (F16) cut:** show only the prize payout batch.
- **Dashboard agent (F21) cut:** show the four custom widgets cross-filtering.

The four "never cut" shots must stay: the approval popup next to an automatic payment, the Gantt task unlocking when an invoice is paid, the kill switch, and the rules engine.

## Open items

- [ ] Confirm the hook footage source (we film it ourselves, no stock with logos).
- [ ] Time each beat against a rough screen recording once Core works (Nov 3).
- [ ] Pick the voice-over speaker.
