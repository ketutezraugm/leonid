# Demo video script

Owner: P4. The shooting script for the PayPal AI Hackathon video: what to click, what the voice-over says word for word, and what has to be true before recording. Target length 2:52, hard cap 3:00 (PRD §10).

It shows only what works on `development` today (Nov 10). Where the product changed since the first draft (no approval step, no rules compiler yet, no agent purchases yet, no late-delivery recovery), the beat was rebuilt around what is real; see [What the video leaves out](#what-the-video-leaves-out).

## Runtime

| # | Time | Beat | Shows | Owner |
| - | --------- | ------------------------- | ------------------------------------------------------------- | ------ |
| 1 | 0:00–0:10 | Hook | The problem | P4 |
| 2 | 0:10–0:16 | Title | Leonid and Leo | P4 |
| 3 | 0:16–0:28 | Log in and the event | Log in with PayPal (F1), event setup (F3) | P2, P4 |
| 4 | 0:28–0:55 | Leo plans the venue | The agent (F11), venue scout | P1 |
| 5 | 0:55–1:20 | Rules are code | Max spend blocks, then the agent wallet pays (F9, F13), invoice PDF | P1, P2 |
| 6 | 1:20–1:35 | One plan | Bryntum Gantt (F11) | P4 |
| 7 | 1:35–1:55 | Money in | PayPal Invoicing and webhooks (F4) | P3 |
| 8 | 1:55–2:18 | Pay people | Receipt claims (F16), payouts in 3 countries (F17) | P3 |
| 9 | 2:18–2:32 | Command center | AG Studio widgets (F20), dashboard agent (F21) | P3 |
| 10 | 2:32–2:44 | Kill switch | PayPal deletes the vault token (F15) | P2 |
| 11 | 2:44–2:52 | Close | Sponsor report (F22) on a Render Workflow, tagline | P2, P4 |

The voice-over is about 280 words, roughly two minutes of speech at an easy pace, which leaves room to let the screen breathe.

## Beats

### 1. Hook · 0:00–0:10

**On screen:** filmed by us, no logos. An organizer at a folding table pays for a stack of pizza boxes with their own card, then a phone full of receipt photos.

**Voice-over:** "Every community event has one volunteer paying for pizza on their own card, then chasing receipts for weeks."

### 2. Title · 0:10–0:16

**On screen:** the landing hero on its night sky: "leonid" with the pink "eo", the meteors drifting, Leo turning towards the cursor. Hold, then fade.

**Voice-over:** "Leonid is an AI agent that runs your event's money on PayPal, inside rules it cannot break."

**Caption:** Every event, on course.

### 3. Log in and the event · 0:16–0:28

**On screen:**
1. Landing: click **Log in with PayPal**. The PayPal sandbox login, already filled in: click Log in.
2. Back in Leonid, All events: click **OpenHack 2027**. It opens in Leo's chat; the sidebar shows Mar 14 and the countdown.

**Voice-over:** "The organizer logs in with PayPal. OpenHack 2027, two hundred people on March 14, opens straight into a chat with Leo."

**Caption:** PayPal sandbox · no real money

### 4. Leo plans the venue · 0:28–0:55

**On screen:**
1. Type: "Find us a venue for 200 people in Jakarta."
2. Leo's checklist appears; Leo asks what to book. Tick **Venue** and **Food & drinks**, send.
3. Leo scouts the demo listings; the results panel fills with venues (speed up the wait).
4. Pick the rehearsed venue (see [Before recording](#before-recording)). The plan summary opens: what the price covers, the one-day estimate and the total in US dollars.

**Voice-over:** "Ask for a venue. Leo checks what to book, scouts listings that fit two hundred people, and turns the one you pick into a plan, with the total in US dollars."

**Caption (over the wait):** Sped up

### 5. Rules are code · 0:55–1:20

The video's most important shot: the same payment refused by a rule, then paid.

**On screen:**
1. In the chat header, click **Add rule**. Type `500`, **Save rule**. Toast: "The agent can spend at most $500.00 on OpenHack 2027."
2. The plan summary now warns: "This is over your max spend, so the spending rules will block it."
3. Tick "I have read this plan…", click **Agree and pay with PayPal**: "Checking the rules…", then **"Blocked by the spending rules: would pass the $500.00 maximum spend for this event."** Hold on it.
4. Click the max spend in the chat header again, type `8000`, save.
5. **Agree and pay with PayPal** again: "Paid with PayPal. PayPal reference …". Click **Download invoice (PDF)** and show the PDF for a second.

**Voice-over:** "Now a rule: a five-hundred-dollar maximum spend. Leo can't talk its way past it, because the check is code, not a prompt. Raise the limit, and the same payment goes through the agent's PayPal wallet, with an invoice."

**Caption (on the block):** Checked in code before any money moves

### 6. One plan · 1:20–1:35

**On screen:** Plan. The Bryntum Gantt: the venue booking tasks Leo just added, the three sponsor invoice tasks, the **Funded by** column (Speaker travel · Harbor Cloud, Buy prizes · Lumen Labs, Catering deposit · Pixel Foundry), the today line and the fixed event day. Scroll gently to event day.

**Voice-over:** "Everything lands on one plan: what gets booked, which sponsor pays for it, and what has to be done before event day."

### 7. Money in · 1:35–1:55

**On screen:**
1. Money › **Sponsors and invoices**. Pixel Foundry, $2,500.00, Pledged: click **Draft invoice**. The draft shows the line, the total and the note. Type the sponsor's sandbox email, **Send invoice**. The row turns **Sent**.
2. Cut to the second browser (the sponsor's PayPal sandbox account): open the invoice, pay it.
3. Back in Leonid: the row turns **Paid** on its own (the list checks every 10 seconds; cut to it).
4. Quick cut to Plan: "Pixel Foundry invoice" is done, and Catering deposit reads paid.

**Voice-over:** "Sponsors get a real PayPal invoice. When Pixel Foundry pays, PayPal's webhook marks it paid, and the plan knows who funded what."

### 8. Pay people · 1:55–2:18

**On screen:**
1. Claims: add a volunteer; their link and QR code appear.
2. On a phone (filmed or mirrored): scan the QR, snap a $42.50 snack receipt. The fields fill in; "Claims up to $50.00 a day are paid automatically"; submit. The green result panel: paid to PayPal.
3. Money › **Payouts**: pay three prize winners, each with their country (for example Indonesia, Malaysia, Singapore), one of them over $200. They go straight to PayPal; the list shows each item's status as PayPal's webhooks arrive.

**Voice-over:** "Volunteers snap a receipt on their phone and are paid back to PayPal, within a fifty-dollar daily limit. Prize winners in three countries are paid in one batch, each tracked to the cent."

### 9. Command center · 2:18–2:32

**On screen:**
1. Money › **Command center**: the funding, budget burn, rules health and delivery risk widgets. Click Swag in budget burn: the other widgets filter to it.
2. **Ask the dashboard agent**: "Where are we overspending?" It adds a chart of spend against each category's cap (P3's runs title it "Spend vs Cap by Category"; the agent names it, so the title can vary). About 80 seconds live: speed it up.

**Voice-over:** "The command center shows where the money went. Ask it where you're overspending, and it builds the chart."

**Caption (over the wait):** Sped up

### 10. Kill switch · 2:32–2:44

**On screen:**
1. Settings: **Revoke agent wallet**. The dialog names the consequence; confirm. The wallet reads **Revoked**.
2. Back on a second venue plan (prepared, unpaid), **Agree and pay with PayPal**: refused, with the prompt to connect a wallet.

**Voice-over:** "And one click stops everything. PayPal deletes the agent's payment token, so the next payment fails at PayPal itself."

### 11. Close · 2:44–2:52

**On screen:**
1. Two seconds of the Render dashboard: the `sponsor-reports` workflow run, succeeded.
2. Harbor Cloud's sponsor report on a phone: where their money went, by category, with PayPal IDs.
3. End card: the night sky, Leo peeking from the bottom edge, "leonid", "Every event, on course.", the repo URL and "Built for the PayPal AI Hackathon".

**Voice-over:** "After the event, every sponsor gets a report of where their money went. Leonid: every event, on course."

## Before recording

On staging, the morning of the recording, with the demo seed fresh.

- **Seed and accounts:** reset the demo data. OpenHack 2027 with Harbor Cloud, Lumen Labs and Pixel Foundry pledged; Pixel Foundry not yet invoiced. A sponsor PayPal sandbox account logged in on a second browser profile. Payout recipient sandbox accounts for the three winners.
- **Agent wallet:** connected (the demo wallet pool has standby tokens). No max spend set on the event before beat 5.
- **The venue for beat 5:** in rehearsal, find a demo venue whose USD total is above $500 and below $1,000. Above $500 so the max spend blocks it; below $1,000 because the demo's daily auto-pay cap is $1,000 (`apps/api/src/rules/demoRules.ts`), and a larger plan would go to a treasurer approval instead of paying from the wallet. Use the same venue and wording in every take.
- **Beat 10:** a second chat with a picked venue, unpaid, ready before revoking. After recording, reconnect a wallet.
- **Beat 8:** a phone on the same staging URL, a snack receipt under $50 on the table.
- **Beat 9:** the dashboard agent's model key set on staging. Record its answer in one take: a chart it adds is gone after a reload.
- **Beat 11:** run the `sponsor-reports` workflow and copy Harbor Cloud's report link from Money › Sponsors and invoices › Share report. Keep the Render dashboard tab open on that run.
- **Screen:** 1920×1080, browser at 100%, light theme, no bookmarks bar or extensions, notifications off. Move the mouse slowly; Leo and the cards follow it.

## Recording rules

- Record the screen and the voice-over separately; burn in captions for every line.
- Speed up any wait over two seconds and caption it "Sped up". Never cut in a way that hides a failure or a step.
- Everything is the PayPal sandbox; say so on screen once (beat 3).
- No third-party logos or copyrighted music. PayPal's own sandbox pages are fine. Products and vendors stay generic.

## What the video leaves out

These were in the first draft and are not filmable on `development` today. Leaving them out keeps every shot true.

| Left out | Why | Replaced by |
| --- | --- | --- |
| The approval popup next to an automatic payment | The approval step was removed on Nov 9 (#115) | Beat 5: the same payment blocked by a rule, then paid |
| The agent buying carts from Channel3 | The agent has no purchase tools yet: it says so itself | Beat 4: Leo scouts and plans the venue; beat 5 pays it |
| Typing rules in plain English (F8) | The rules compiler has not landed; the demo rules are fixed in code | Beat 5: the max spend, the one rule an organizer sets today |
| Late swag: refund, reorder, replan (F18/F19) | Not built; the delivery risk widget shows sample data | Beat 6: the plan with live sponsor funding |
| A task unlocking when an invoice is paid | The sponsor gate was removed on Nov 6 | Beat 7: the invoice task turns done and its purchases read paid |

If any of these land before recording, add it back only after it has been run end to end on staging.

## Fallbacks

- **The dashboard agent is slow or fails:** in beat 9, show the widgets cross-filtering only and cut the question.
- **The phone claim fails:** in beat 8, show the payouts only.
- **The invoice webhook is slow:** in beat 7, cut to the Paid row after it arrives; the voice-over still fits.
- **The venue scout is slow:** speed it up; if it fails, use a take from rehearsal.

## Never cut

The payment blocked by a rule and then paid (beat 5), the plan (beat 6), the kill switch (beat 10) and a PayPal money movement with its webhook (beat 7 or 8).

## What each prize sees

- **PayPal:** Log in with PayPal, the Vault (the agent wallet and its kill switch), Orders (the venue payment), Invoicing, Payouts, webhooks, and Transaction Search behind the sponsor report.
- **AG Studio:** the command center's widgets and the dashboard agent (beat 9).
- **Bryntum:** the Gantt plan with sponsor funding (beat 6).
- **Render:** the sponsor report as a Render Workflow (beat 11).
- **APIMatic:** not on screen; the README's APIMatic section carries it.

## Open items

- [ ] Film the hook ourselves (no stock with logos).
- [ ] Pick the voice-over speaker.
- [ ] Rehearse on staging and pick the beat 5 venue (P1, P4).
- [ ] Confirm the second venue plan in beat 10 is refused with the wallet revoked, and what the screen says (P2).
- [ ] Time the full run against the 3:00 cap.
