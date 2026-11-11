# Competitor analysis and plan to win

Owner: P4. As of Nov 6, 2026. Sources: the hackathon rules and bounty list, `docs/PRD.pdf`, the `development` branch, and the READMEs of 62 rival repos on GitHub. We read their READMEs only; we did not run their apps or check their code. The interactive version of this page is a private artifact owned by P4.

## Verdict

**We can win a grand prize, but not by pitching "spending guardrails for AI agents".** It is the most crowded idea (95 of 517 public repos), and at least five strong rivals already pitch it well: Cosign, Undo, Mandate Wallet, PayWarden and Agent Firewall.

**Updated Nov 6:** the team removed the sponsor gate from the PRD (PR #92). The organizer's own PayPal account pays, so "a budget that is only cleared money" and "a task that unlocks when a sponsor pays" are no longer ours to claim.

What no rival has now: **one product that runs a whole community event's money and plan on PayPal**, for one clear person: the volunteer who runs the event and ends up paying for pizza. Sponsors are invoiced and tracked, an agent buys within rules it can't break, volunteers, speakers and winners are paid, and the Gantt replans when a delivery runs late. Use the guardrails as the proof that it is safe. No event-focused rival turned up; the nearest, StraightMoney, is a fundraiser with budget lines and no plan.

Both sponsor pools we target are busy. At least 7 entries already have an AG Studio agent (5 winners), and 16 use Bryntum (3 winners), two of which move phases on a PayPal webhook. The gap nobody fills is **an agent that reschedules when a delivery runs late**. With the sponsor gate gone, F18/F19 is the only thing that makes our Gantt stand out.

Before the Nov 8 freeze we must close four PRD Core gaps that judges will see (Rules screen, Audit log, the agent-built plan, Channel3 options on approvals), then ship late-delivery rescheduling (Bryntum) and, if P3 has time, the AG Studio dashboard agent.

## How judging works

Every prize, sponsor prizes included, is scored on the same five criteria, with equal weight:

- Technological Implementation (also breaks ties)
- Design: a complete product, not a proof of concept
- Potential Impact: a specific problem, a real audience, shown in the demo
- Innovation: how it differs from existing ideas
- Presentation: the video shows it working end to end

Rules that change our plan:

- Judges may score from the description, images and video alone, without running the app.
- One project wins at most one general prize plus one sponsor prize.
- Required: a hosted URL or full setup steps, a video under 3 minutes with no trademarks or unlicensed music, an open-source licence visible in the repo's About, and the AI tools and models used and how each was used.
- Deadline: Nov 13, 03:00 WIB. Our internal submit is Nov 10.

## How crowded each idea is

Public repos that mention the hackathon by name, as of Nov 6 (517 in total):

| Idea | Repos | Share |
| --- | ---: | ---: |
| Guardrails and spending limits for AI agents | 95 | 18% |
| Invoicing, billing and collections | 76 | 15% |
| Disputes, chargebacks and refunds | 52 | 10% |
| AI shopping agents and agent-ready stores | 48 | 9% |
| Escrow, pay only after proof | 45 | 9% |
| Bill splitting and group money | 17 | 3% |
| Scam and fraud protection | 8 | 2% |
| Other and niche | 129 | 25% |
| No real description yet | 47 | 9% |

## Prize by prize

| Prize | Strongest rivals (per README) | Our position | What would win it for us |
| --- | --- | --- | --- |
| **1st–3rd** ($12k / $8k / $5k) | [milestone-escrow](https://github.com/jeroenzwiers/milestone-escrow) (multi-agent planning, video, 70 tests, real sandbox runs), [Cosign](https://github.com/Osteeen/cosign), [Undo](https://github.com/shloknarvekar/undo), [witness](https://github.com/fexx301/witness), [jastip](https://github.com/daefery/jastip) | Contender. One of the widest PayPal footprints in the field (Login, Invoicing, Orders, Vault, Payouts, Transaction Search, webhooks, Render Workflows), proven on staging | Lead with the whole event on PayPal (money in, money out, the plan) and the late-delivery replan; fill the Core gaps judges will screenshot; a video that runs one event end to end |
| **Best Use of Agentic Commerce** ($5k) | Cosign, [Mandate Wallet](https://github.com/thiagopari/mandate-wallet), [procure-agent](https://github.com/rayhannajla-hash/procure-agent), milestone-escrow, [sightline](https://github.com/Thomas-Wood-Eng/sightline) | Strong fit. The agent sources, buys with a vaulted wallet inside code rules, the treasurer approves in the PayPal popup, and the kill switch is proven | Show the three Channel3 options and the agent's pick inside the approval; show it refusing an instruction hidden in a product page |
| **Most Impactful** ($5k) | [peakshift](https://github.com/BlueSkiez-dev/peakshift), [ebb](https://github.com/usmanmateen/ebb) (real grid data), [jaga-bersama](https://github.com/phyllicai/jaga-bersama) | Weak today: our pitch has no sourced numbers | Open the video with one or two sourced figures on organizers fronting costs and late sponsor money |
| **Best Demo Delivery** ($5k) | Rivals with a real video: Cosign, milestone-escrow, tranche, paid-signal, agentaisle | Open; P4's prize focus in the PRD | One continuous run on the seeded event, captions, ending on the kill switch refusal and the hosted URL |
| **AG Grid** ($10k, 5 winners) | [paid-signal](https://github.com/longtt-marketing/paid-signal) (6 custom widgets, Studio agents, video, 178 tests), peakshift (5 widgets, agent delegates to Studio's agents), witness (custom theme, 2 custom agents), [settlesight](https://github.com/RyanDev1st/settlesight), [rebook](https://github.com/harsha31bs07-blip/rebook) (4 widgets, theme, Studio agents, hosted), [tidewater](https://github.com/kaushikm2706-tech/tidewater) (Studio agent, hosted, video, 58 tests), [owed](https://github.com/edilsonsantos-co-za/owed) | Half there: AG Studio as the Money screen, 4 custom widgets, cross-filtering, themed from our tokens. No Studio agent yet (F21); at least 7 rivals have one, for 5 places | F21 done well: "Where are we overspending?" builds a widget through a custom agent that delegates to Studio's built-in agents, on the hosted URL, with a theme story. Necessary to place at all; not enough to stand out alone |
| **Bryntum** ($3k, 3 winners) | [tranche](https://github.com/dumplingdeveloper/tranche-paypal-bryntum) (agent proposes a reschedule on late payment, Apply and Undo, 74 tests, video, no hosted demo), [milestone](https://github.com/Sarcastic-Soul/milestone) (a paid invoice unlocks the next Gantt phase, agent proposes moving stuck phases, hosted), [cutoff](https://github.com/rogerkoranteng-crypto/cutoff) (agent reflows a Scheduler on a PayPal refund webhook, hosted), [owed (Scheduler)](https://github.com/Stephen-Psaradellis/owed), rebook | Behind until F18/F19: 16 entries. With the sponsor gate removed, our Gantt shows which sponsor funds each purchase and invoice status live, but nothing on it reacts to an event yet | F18/F19: a late delivery makes the agent move dependent tasks and flag the milestone, with a refund and reorder, event day fixed. No rival reschedules on a delivery event |
| **APIMatic** ($3k, 3 winners) | [stood](https://github.com/ma-za-kpe/stood) (generated SDK, docs portal), [hearthline](https://github.com/AnshulPatil2005/hearthline-paypal-apimatic) (plan file, `mypy --strict`), Cosign, Undo | Weak: our README says the PayPal client was written before the plugin ran, and the log is a cross-check | Build the next PayPal pieces (refund, tracking) with the Context Plugin and publish the prompt log. No rival publishes theirs |
| **Channel3** ($1.5k, 1 winner) | procure-agent, [gift-directory](https://github.com/banksythequantLab/gift-directory), Cosign, Undo, dispute-radar | Long shot: one winner, most contested | Not a target. Keep sourcing visible for Agentic Commerce instead |
| **Render** (credits, 3 winners) | Many deploy on Render; few use Workflows (stood does) | Strong: three Workflows (budget recompute, invoice reminders, sponsor report) | Screenshots of the Workflow runs in the README |

**Sponsor prize choice:** we can win only one. Lead with Bryntum, through late-delivery rescheduling, which no rival has. Treat AG Grid as a second chance that needs F21 done well.

## Where Leonid stands (PRD against `development`, Nov 6)

The PRD says Core had to work by Nov 3 and Upgrades by Nov 7.

| Feature | Tier | Owner | Status | What is missing |
| --- | --- | --- | --- | --- |
| F1 Sign in, F2 Treasury, F3 Event setup | Core | P2, P4 | Done | |
| F4 Sponsor invoices | Core | P3 | Partial | API merged; the Sponsors and invoices tab is built by P3, not pushed |
| F8 Rules compiler | Core | P1 | Missing | No rules endpoint; the Rules screen's input is disabled. A never-cut shot ("rules engine as code") has no screen |
| F9 Rules engine | Core | P1, P2 | Done | Wired to real rules (PR #53) |
| F10 Funds-gated budget | Core | P1 | Removed | Gate removed from the PRD on Nov 6 (PR #92). Unlocked budget is still shown, for information. A user-set maximum spend is planned |
| F11 Planning agent and Gantt | Core | P1 + P4 | Partial | The agent writes tasks, but there is no plan endpoint, so the Gantt shows sample tasks. Live sponsor status and the Funded by column are on a local P4 branch |
| F12 Channel3 sourcing | Core | P1 | Partial | Options, pick and reason are not attached to the approval |
| F13 Auto payment, F14 Approval, F15 Kill switch | Core | P2 | Done | Proven on staging with real PayPal (Nov 4) |
| F20 Command center | Core | P3 | Done | 4 custom widgets, cross-filtering |
| F23 Audit log | Core | P1 | Missing | Not visible on Approvals or Money (the Audit tab is empty). The data exists in `/api/spends/recent` |
| F5 Reminders, F6 Tickets, F22 Sponsor report | Upgrade | P2, P3 | Done | F22 built by P2, with a Transaction Search cross-check |
| F16 Receipt claims | Upgrade | P3 | Partial | The payout path exists; no claims endpoints or phone flow |
| F17 Speaker and prize payouts | Upgrade | P3, P2 | Partial | Backend and payout approvals merged (PR #90); the Claims, volunteer phone and Payouts screens are on P3's branch, not merged |
| F18 Tracking, F19 Late-delivery recovery | Upgrade | P4 | Missing | Not started. This is the Bryntum "agent drives the schedule" feature and the video's Late swag beat |
| F21 Dashboard agent | Upgrade | P3 | Missing | Not started. Needed to compete for the AG Grid prize |

The PRD's cut order drops the dashboard agent before receipt claims are cut. Given the AG Grid pool, we suggest cutting receipt claims first. P3 has since built the claims screens, so this may not be needed.

## What to improve, in order

| # | Change | Why (criterion or prize, and the rival to beat) | Owner | By |
| ---: | --- | --- | --- | --- |
| 1 | Rules screen live: each rule in plain English next to its structured version, marked "enforced in code" (F8) | Core and never-cut. Design. Cosign and Mandate Wallet show their rules; we show a disabled box | P1 endpoint, P4 screen | Nov 7 |
| 2 | Audit log on Money and Approvals: who asked, the rule result and reason, the PayPal ID (F23) | Core. Technological Implementation. Witness and Undo publish real run records | P4 from `/api/spends/recent`; P1 for agent actions | Nov 7 |
| 3 | The Gantt shows the agent's real plan: the plan endpoint, then wire it in with live sponsor status (F11) | Core and never-cut ("the Gantt the agent built") | P1 endpoint, P4 wiring | Nov 7 |
| 4 | Late-delivery recovery: the agent moves dependent tasks, flags the milestone, refunds and reorders; event day stays fixed (F18, F19) | Bryntum, our main sponsor bet, and now the Gantt's only standout. tranche, milestone and cutoff react to payments; none reacts to a late delivery | P4, refund call by P2 | Nov 8 |
| 5 | Dashboard agent: "Where are we overspending?" builds a widget through Studio's built-in agents (F21) | AG Grid: 5 winners but 7+ rivals with a Studio agent (paid-signal, peakshift, rebook, tidewater set the bar) | P3 | Nov 7 |
| 6 | Three Channel3 options, the pick and its reason inside each approval (F12) | Agentic Commerce. procure-agent shows the basket the model proposes | P1 | Nov 7 |
| 7 | Build the refund and tracking calls with the APIMatic Context Plugin and publish the prompt log | APIMatic. No rival publishes its prompts | P2 | Nov 8 |
| 8 | New pitch: a whole community event's money and plan on PayPal, for the volunteer organizer, with sourced numbers; "AI proposes, code pays" | Innovation, Potential Impact | P4 | Nov 8 |
| 9 | README judge kit: hosted URL with Enter the demo, a table of what is live and what is sample, live sandbox IDs from staging, test counts, the AI models and how each is used, screenshots of every screen, the licence in About | Judges may never open the app. Sorted and Verdict publish live-vs-mock tables | All; P4 assembles | Nov 9 |
| 10 | Video under 3 minutes, captions, one continuous run, ending on the kill switch refusal and the URL | Presentation, Best Demo Delivery | P4 | Nov 9 |

## What to copy from the best rivals

In the product:

- Show the agent refusing an instruction hidden in a product page (our venue scout already has this test). Mandate Wallet ships a red-team suite.
- Read back PayPal's own amount before money moves (sightline).
- Label every number as sample or live, as we already do on screen, and say so in the README too.

In the submission:

- A one-click hosted demo with no sandbox buyer or access code needed; many rivals lack this.
- A "For judges" walkthrough of 3–5 steps (jastip, witness).
- Stated test counts and an explicit Limitations section (milestone-escrow, Verdict).
- No placeholder video or demo links; several rivals still have "link added later".

## Rival repos read

| Category | Repo | What it does | Note |
| --- | --- | --- | --- |
| Guardrails | [natrajexplore/paywarden](https://github.com/natrajexplore/paywarden) | Zero-trust payment firewall for AI agents | Deterministic policy, TOTP step-up; no kill switch; no video |
| Guardrails | [midas-png/paypal-agent-firewall](https://github.com/midas-png/paypal-agent-firewall) | Checks every agent payment against your rules | Z3 proof of the mandate; no human approval step |
| Guardrails | [thiagopari/mandate-wallet](https://github.com/thiagopari/mandate-wallet) | Signed spending rules; 13 checks before a payment | Vault, kill switch, red-team suite, hosted |
| Guardrails | [shloknarvekar/undo](https://github.com/shloknarvekar/undo) | An undo button for AI agent purchases | All 5 sponsor tools, hosted, 49 tests, live order links |
| Guardrails | [Osteeen/cosign](https://github.com/Osteeen/cosign) | Company card for AI agents that a human co-signs | Closest rival: rules engine, revoke, APIMatic, video, hosted |
| Invoicing | [OlsOls4/sorted](https://github.com/OlsOls4/sorted) | Job notes to invoices for UK sole traders; chases late payers | Signed single-use approval tokens; deep AG Grid; hosted |
| Invoicing | [greatgeekgrace/ledgerbird](https://github.com/greatgeekgrace/ledgerbird) | AI accounts-receivable agent for freelancers | Hosted on Render; 3 commits, no tests |
| Invoicing | [leex0x0/invoice-chaser](https://github.com/leex0x0/invoice-chaser) | Chases unpaid invoices via PayPal Invoicing | No AI yet; 1 commit; no sandbox run |
| Invoicing | [0xzahra/chat-to-invoice](https://github.com/0xzahra/chat-to-invoice) | WhatsApp or Telegram order chat to a PayPal invoice | 12 languages; hosted; 1 test |
| Invoicing | [Talal-ah-cloud/invoicepilot](https://github.com/Talal-ah-cloud/invoicepilot) | WhatsApp message to a PayPal invoice | Roadmap contradicts its claims |
| Invoicing | [fadhilmuhaimin/panjar](https://github.com/fadhilmuhaimin/panjar) | Tourists' WhatsApp chats to PayPal deposit invoices | Indonesian; code owns money; Render cron |
| Disputes | [HenryTech12/Verdict](https://github.com/HenryTech12/Verdict) | Handles disputes end to end: fight, refund or escalate | 482 tests; live-vs-mock table; hosted |
| Disputes | [DhyeyPatel007/phalanx](https://github.com/DhyeyPatel007/phalanx) | AI agents argue each dispute from both sides | No live PayPal execution |
| Disputes | [ruslanpavliichuk/dispute-radar-paypal](https://github.com/ruslanpavliichuk/dispute-radar-paypal) | Predicts which orders become disputes | AG Studio, Bryntum, Channel3, Render; real sandbox actions |
| Disputes | [fexx301/witness](https://github.com/fexx301/witness) | Answers disputes, including ones over agent purchases | Deep AG Studio: custom theme, 2 custom agents |
| Shopping | [Eman2123/Shelf-Ready](https://github.com/Eman2123/Shelf-Ready) | Makes small stores buyable by AI shopping agents | Day 1 of the build per its README |
| Shopping | [sreenivasivbieb/openshelf](https://github.com/sreenivasivbieb/openshelf) | Product CSV to a store AI agents can buy from | Skeleton; stubs return 501 |
| Shopping | [ChrisTu117/paypal-webmcp-shop](https://github.com/ChrisTu117/paypal-webmcp-shop) | One script tag makes a shop orderable by agents | Hosted; needs a Chrome flag |
| Shopping | [Thomas-Wood-Eng/sightline](https://github.com/Thomas-Wood-Eng/sightline) | Voice-first shopping for blind and low-vision people | Reads back PayPal's amount before capture; links unfinished |
| Shopping | [rayhannajla-hash/procure-agent](https://github.com/rayhannajla-hash/procure-agent) | Factory purchasing agent with Channel3 and PayPal approval | Channel3 in the main flow; vault wallet; hosted |
| Shopping | [banksythequantLab/gift-directory](https://github.com/banksythequantLab/gift-directory) | AI gift store with Channel3 products and group gifts | 121 tests; hosted |
| Escrow | [ma-za-kpe/stood](https://github.com/ma-za-kpe/stood) | Money moves only after on-site proof | Deepest APIMatic use; 325 commits; much unbuilt |
| Escrow | [jeroenzwiers/milestone-escrow](https://github.com/jeroenzwiers/milestone-escrow) | Freelance milestone payments after verification | Grand-prize contender: video, 70 tests, real sandbox |
| Escrow | [vendrck/ProofPay](https://github.com/vendrck/ProofPay) | AI-verified freelance escrow | Not deployed |
| Escrow | [carbonsignal1/proof-of-done](https://github.com/carbonsignal1/proof-of-done) | Pays for small jobs after photo proof | AG Grid ledger; no hosted URL |
| Bill splitting | [Kamal934/splitpay-ai](https://github.com/Kamal934/splitpay-ai) | Snap the bill; AI splits it into PayPal invoices | Agent Toolkit, AG Grid, Render; hosted |
| Bill splitting | [lionel509/SplitSlip](https://github.com/lionel509/SplitSlip) | Receipt to an invoice per friend | Planning only |
| Bill splitting | [bgrubbs1/splitmate-paypal-ai](https://github.com/bgrubbs1/splitmate-paypal-ai) | Messy group plan to a fair split and PayPal orders | 181 tests; live PayPal unverified |
| Bill splitting | [daefery/jastip](https://github.com/daefery/jastip) | Shop abroad for friends with a held maximum price | Partial capture per receipt line; hosted |
| AG Studio | [longtt-marketing/paid-signal](https://github.com/longtt-marketing/paid-signal) | Matches PayPal payments to ad clicks | Top AG Grid rival: 6 widgets, Studio agents, 178 tests, video |
| AG Studio | [edilsonsantos-co-za/owed](https://github.com/edilsonsantos-co-za/owed) | AI collections copilot with an approval queue | Studio's 5 agents plus a custom agent; no hosted demo |
| AG Studio | [RyanDev1st/settlesight](https://github.com/RyanDev1st/settlesight) | Reconciles PayPal invoices with transactions | Brand theme, 3 widgets; its agent can't build widgets |
| AG Studio | [dumplingdeveloper/tillwise-paypal-money-desk](https://github.com/dumplingdeveloper/tillwise-paypal-money-desk) | Voice store agent with an AG Studio money desk | Agent-built widgets; needs Docker |
| AG Studio | [kamalkatul92kk-sudo/agentaisle](https://github.com/kamalkatul92kk-sudo/agentaisle) | Agent-ready storefront with a merchant console | Best-polished AG Grid (not Studio); video, 109 tests |
| AG Studio | [harsha31bs07-blip/rebook](https://github.com/harsha31bs07-blip/rebook) | Studio recovery desk that rebooks a broken week | High threat: 4 widgets, theme, Studio agents, Bryntum, hosted |
| AG Studio | [kaushikm2706-tech/tidewater](https://github.com/kaushikm2706-tech/tidewater) | Receivables forecasting cockpit | High threat: Studio agent, 2 widgets, hosted, video, 58 tests |
| AG Studio | [Elioz404/Sayso](https://github.com/Elioz404/Sayso) | Shop platform run by an owner agent | AG Grid and AG Studio, hosted, video; no Studio agent |
| AG Studio | [GGGODLIN/paypal-credit-roll-live](https://github.com/GGGODLIN/paypal-credit-roll-live) | End-credits ledger with PayPal settlement | Claims widgets and a Studio agent; not hosted |
| AG Studio | [adamm285-dev/ap2-commerce](https://github.com/adamm285-dev/ap2-commerce) | AP2 agent-payments operations deck | 792 tests; AG Studio is one ledger |
| AG Studio | [Kulraj69/chargeback-court](https://github.com/Kulraj69/chargeback-court) | AI paralegal for PayPal disputes | Themed AG Grid docket, hosted; no Studio |
| AG Studio | [dayveedd/py-fides](https://github.com/dayveedd/py-fides) | AP2 escrow on Orders v2 and PYUSD | AG Grid Enterprise ledger; not hosted |
| AG Studio | [jamesparser/paypal-commerce-mcp](https://github.com/jamesparser/paypal-commerce-mcp) | OmegaCommerce: fund provenance dashboard | Built on the official boilerplate; video, hosted |
| AG Studio | [Chinmoy-04/ShopCrew-PayPal](https://github.com/Chinmoy-04/ShopCrew-PayPal) | Agents refund customers and pay suppliers | Themed Studio page; no custom widgets stated |
| Bryntum | [dumplingdeveloper/tranche-paypal-bryntum](https://github.com/dumplingdeveloper/tranche-paypal-bryntum) | Payment tranches drive a Gantt; agent proposes reschedules | Apply and Undo, 74 tests, video; no hosted demo |
| Bryntum | [Sarcastic-Soul/milestone](https://github.com/Sarcastic-Soul/milestone) | Contract to Gantt; a paid invoice unlocks the next phase | Closest to our Gantt; agent proposes moves; hosted |
| Bryntum | [rogerkoranteng-crypto/cutoff](https://github.com/rogerkoranteng-crypto/cutoff) | Dispute triage board on a Scheduler | Agent reflows the board on a PayPal webhook; hosted |
| Bryntum | [Stephen-Psaradellis/owed](https://github.com/Stephen-Psaradellis/owed) | Collections agent with reminders on a Scheduler | A paid webhook cancels reminders; hosted; 62 tests |
| Bryntum | [ifrazie/flow-paypal-ai](https://github.com/ifrazie/flow-paypal-ai) | Freelancer money copilot with a payment-gated timeline | Thin docs; no tests |
| Bryntum | [fokrulanthro16-eng/milestonepay-ai](https://github.com/fokrulanthro16-eng/milestonepay-ai) | Gantt from a contract, escrow per milestone | Hosted, video; payment doesn't drive the Gantt |
| Bryntum | [jacopogonzales-cloud/shiftly](https://github.com/jacopogonzales-cloud/shiftly) | Crew scheduling with PayPal Payouts | Scheduler with constraints; hosted |
| Bryntum | [barood-labs/paypilot](https://github.com/barood-labs/paypilot) | Bookings with pay links on a calendar | Bryntum Calendar only for colour |
| Bryntum | [gino6178/join](https://github.com/gino6178/join) | Group activities: agents book and split | Widest PayPal surface; Bryntum secondary |
| Bryntum | [Zhiyilang/paypilot-bryntum](https://github.com/Zhiyilang/paypilot-bryntum) | Scheduler where an unpaid phase blocks the next | Matches the brief; no hosted demo confirmed |
| Bryntum | [harrymove-ctrl/paypal-sentinel](https://github.com/harrymove-ctrl/paypal-sentinel) | Multi-track suite with a delivery-linked timeline | Hosted, video; reschedule link not stated |
| Bryntum | [rogerjeasy/hold](https://github.com/rogerjeasy/hold) | PayPal hold instead of a cash deposit for rentals | About 3,900 tests, hosted, video; Bryntum minor |
| Niche | [BlueSkiez-dev/peakshift](https://github.com/BlueSkiez-dev/peakshift) | AI-coordinated electricity flexibility with payouts | 5 AG Studio widgets plus a Studio agent; hosted |
| Niche | [usmanmateen/ebb](https://github.com/usmanmateen/ebb) | Household agents bid electricity flexibility | Grounded in real NESO data; 107 tests |
| Niche | [michaelbarkovskis/rain-day-cover](https://github.com/michaelbarkovskis/rain-day-cover) | Rain-day income cover for UK roofers | README is a stub |
| Niche | [Will413028/tidehold](https://github.com/Will413028/tidehold) | Weather-cancellation deposits for dive shops | 139 commits; not demoable yet |
| Niche | [mapulimapuli782-cloud/Majismart](https://github.com/mapulimapuli782-cloud/Majismart) | Water-leak detection in Mwanza | Early; unsourced figures |
| Niche | [phyllicai/jaga-bersama](https://github.com/phyllicai/jaga-bersama) | Splitting eldercare costs among Malaysian families | Caregiving time as credit; no-keys demo |
| APIMatic | [AnshulPatil2005/hearthline-paypal-apimatic](https://github.com/AnshulPatil2005/hearthline-paypal-apimatic) | Transaction Search with APIMatic's SDK and plugin | Most rigorous plugin workflow; excerpt only |
| Event and group money | [abhinavganesh09/StraightMoney](https://github.com/abhinavganesh09/StraightMoney) | Fundraising where the organizer never holds the money | Nearest to us: budget lines, gated payouts; no plan, not hosted |
| Event and group money | [williares162003-lab/junta-paypal](https://github.com/williares162003-lab/junta-paypal) | AI organizer for rotating savings groups | Pot locked until all have paid; 46 tests |

## Next sweep

Re-check event-focused entries, AG Studio entries and Bryntum entries around Nov 10–11 for late submissions. New repos keep appearing until the deadline.
