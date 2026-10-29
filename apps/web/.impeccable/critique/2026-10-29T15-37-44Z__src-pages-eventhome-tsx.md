---
target: Event home
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\HP\\paypal-hack\\apps\\web\\src\\pages\\EventHome.tsx"
target_fingerprint: "sha256:ca8f003641835d2cea95c668d4398126f45eae97a7c0f22acbabfb6efe218f75"
target_path: "C:\\Users\\HP\\paypal-hack\\apps\\web\\src\\pages\\EventHome.tsx"
timestamp: 2026-10-29T15-37-44Z
slug: src-pages-eventhome-tsx
---
---
target: Event home
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\HP\\paypal-hack\\apps\\web\\apps\\web\\src\\pages\\EventHome.tsx"
timestamp: 2026-10-29T15-37-32Z
slug: apps-web-src-pages-eventhome-tsx
---
Method: dual-agent (A: design-review sub-agent · B: detector + browser sub-agent)
Mode: Operate. Dev state: API without PayPal keys (approvals 503); budget, spends and alerts are labelled sample data.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Approvals load error: header says "We couldn't check…", card says "Nothing is waiting on you." |
| 2 | Match System / Real World | 3 | "Committed"/"Pledged" finance-leaning; drawer "database is not configured" is jargon |
| 3 | User Control and Freedom | 3 | Esc + focus return on drawer; no retry on home error |
| 4 | Consistency and Standards | 3 | Consistent statuses; link phrasing varies |
| 5 | Error Prevention | 3 | Home doesn't show wallet / kill-switch state |
| 6 | Recognition Rather Than Recall | 3 | Runway bars named only in hover tooltips |
| 7 | Flexibility and Efficiency | 2 | No skip link; no row actions |
| 8 | Aesthetic and Minimalist Design | 2 | Five equal-weight cards; unlabelled runway leads |
| 9 | Error Recovery | 2 | No Try again on home error; raw drawer error |
| 10 | Help and Documentation | 3 | Good inline definition under Unlocked; nothing for "Rules said" |
| Total | | 26/40 | Acceptable |

## Design Specificity Verdict
Coherent but only partly authored for Quartermaster. The funds-gated BudgetBar is the product-specific element and is buried mid-page in an equal-weight card. Brass appears only in the 16px logo.
Detector: CLI 0 findings. Browser overlay 6: overused-font (false positive, deliberate Geist), repeating-stripes-gradient (false positive: time grid and meaningful hatching), nested-cards x5 (3 on home cards are false positives: inner blocks borderless; 2 inside P1's chat suggestions in the drawer are real).

## Priority Issues
- [P1] Error state says nothing is waiting: branch "Waiting on you" on load state; error shows "Couldn't load approvals" + Try again; drop duplicate sentence. (/impeccable harden)
- [P1] Hierarchy inverted: top band = Unlocked (large) + Needs you; runway moves below as slim strip; waiting item becomes loudest when present. (/impeccable layout)
- [P2] Card sameness, brass unused: emphasise Unlocked card; brass event-day marker and countdown; ledger feel for spends. (/impeccable colorize)
- [P2] Runway decorates: month ticks, named next milestones, "Not started" in legend, at-risk count as text. (/impeccable clarify)
- [P2] Drawer empty state ignores the event and screen: per-screen prompts, inset padding, plain error. Chat is P1's. (/impeccable polish)

## Persona Red Flags
- Alex: no skip link; no route to Approvals in error state; no row actions.
- Sam: runway is one role=img sentence; wrong "Nothing is waiting" announced; grey vs green only on runway bars; 12px grey text.
- Jordan: Committed/Pledged/Invoiced need the legend; opens with an apology; agent prompts about a new event.

## Minor Observations
- Sample label only on budget card; spends and alerts unlabelled.
- Phone: nav strip clips Rules/Claims with a visible scrollbar; FAB covers rows mid-scroll.
- ~200px empty sheet below Alerts on desktop.
- "Allowed" status green reads lime next to forest.

## Questions to Consider
- Without the name and palette, would a judge know this app guards money?
- Why does the plan sit above the spending gate?
- Should "Waiting on you" take over when non-empty and shrink to one line when empty?
