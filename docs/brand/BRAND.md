# Leonid: rebrand handoff to P4

Written for Abel (P4) and her coding agent. Decided by Ezra (P2) on Nov 6, 2026. The visual reference is the design system page (Ezra shares the link): tokens, brand book, logos and cover. This file is what you need to apply it in the repo.

**Timing.** The feature freeze is Sun Nov 8 and the video is recorded by Mon Nov 9, and the video says the product's name. So cut 1 below should land before the freeze. Whether a rename counts as allowed after the freeze is a team call (Harfi merges).

## The decisions

| | |
| --- | --- |
| Product name | **Leonid** (after the Leonids meteor shower). Written "Leonid" in text, "leonid" as the wordmark. |
| Agent name | **Leo** ("Ask Leo"; Leo speaks in the chat) |
| Motto | **Every event, on course.** |
| About the name | **L**ogistics and **E**vent **O**perations, **N**avigated by **I**ntelligent **D**ecisions (README and landing footer only) |
| Palette | "Midnight": indigo `#2B2670` and periwinkle `#A9B0F0`, plus the off color, meteor pink (`#B42D6E` on light, `#FF7AB6` on the night sky `#12132E`) |
| Type | Bricolage Grotesque (titles, wordmark, the headline figure, landing hero), IBM Plex Sans (everything else), IBM Plex Mono (PayPal IDs and rule JSON). All OFL on Google Fonts. |
| Wordmark | Landing page, hero, video, social card: "l**eo**nid" with the "eo" in the meteor color. **Inside the app: plain, one color, no highlight.** |
| Mark | One meteor on a night tile: `assets/leonid-mark.svg`; one-color `assets/leonid-mark-mono.svg`; tab icon `assets/favicon.svg` |
| Graphics | Thin parallel meteor streaks from the top-right. Yes: landing hero, title cards, social card, sponsor report header, empty states, loading. No: tables, forms, Approvals, rules, behind numbers or PayPal buttons. |

## Rules that come from checks, not taste

- **Status never by color alone.** `approval` (#8F5600) and `blocked` (#B42318) are indistinguishable for deuteranopes (checked: CVD ΔE 0.4), and so were today's amber and red. Every status keeps its icon and its word.
- **The meteor pink never colors text that could read as an error** (it sits near `blocked` in hue). In the app it appears only in the mark and the Gantt today line.
- **Charts:** `chart-1` #3D46B8, `chart-2` #D65FA3, `chart-3` #93A6F7, in that order; a fourth series folds into `chart-other` #9A9CB8. Always direct-label (chart-3 is light). This set passed the colorblind validator and stays clear of every status color; the first candidate (with a teal and a rose) failed against the status green and red. If the app ever gets a dark mode, use the dark steps `chart-1` #7C86F2, `chart-2` #CC3F92, `chart-3` #E3E8FE (checked the same way against the dark status colors).
- **Components:** the design system page shows live previews of Button (with the PayPal slot), StatusBadge, Card with the headline figure, Wordmark (plain in-app vs highlighted landing) and BudgetChart, each with its usage rules. Match those when restyling the app's own components.
- **PayPal buttons keep PayPal's gold.** Don't restyle them or put streaks behind them.
- Every text pair passes WCAG AA (body text 15.9:1, secondary 6.3:1, white on indigo 13.0:1, status labels on their badges 4.7 to 5.6:1).

## Cut 1, before the freeze

### 1. Tokens: swap values in `apps/web/src/styles/tokens.css`, keep the names

No component changes; AG Studio (`money/studio-theme.ts`) and Bryntum (`plan/gantt-theme.css`) already read these tokens.

```css
--color-bg: #f4f4fb;
--color-surface: #ffffff;
--color-surface-sunken: #ececf7;
--color-text: #15163a;          /* 15.9:1 on bg */
--color-muted: #55577a;         /* 6.9:1 on white */
--color-border: #dedff0;
--color-rule: #ededf7;
--color-control-edge: #7a7da3;  /* 4.0:1 on white */
--color-accent: #2b2670;        /* indigo; white on it 13.0:1 */
--color-accent-strong: #201c58;
--color-accent-soft: #e8eafc;   /* periwinkle-soft */
--color-on-accent: #ffffff;
--color-data: #3d46b8;          /* chart-1 */
--color-data-soft: #93a6f7;     /* chart-3 */
--color-brass: #b42d6e;         /* now the meteor: mark and Gantt today line only */
--color-brass-text: #b42d6e;    /* landing page only */
--color-brass-soft: #fff1d6;    /* "needs you" surface = approval-soft */
--color-brass-on-dark: #ff7ab6; /* meteor on the night sky */
--color-hold: #d3d5ea;
--color-status-done: #1e7a3e;  --color-status-done-soft: #e2f4e7;    --color-status-done-text: #1e7a3e;
--color-status-pending: #56656a; --color-status-pending-text: #56656a; /* soft stays var(--color-surface-sunken) */
--color-status-risk: #8f5600;  --color-status-risk-soft: #fff1d6;    --color-status-risk-text: #8f5600;
--color-status-blocked: #b42318; --color-status-blocked-soft: #fde7e4; --color-status-blocked-text: #b42318;
--font-sans: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-mono: 'IBM Plex Mono', ui-monospace, 'Consolas', monospace;
--font-display: 'Bricolage Grotesque', 'Avenir Next', 'Segoe UI', system-ui, sans-serif; /* new */
--color-scrim: rgba(21, 22, 58, 0.32);
--shadow-menu: 0 8px 24px rgba(21, 22, 58, 0.14);
```

Then use `--font-display` for page titles, the sidebar wordmark, the one headline figure and the landing headline. Spacing, radius, sizes and motion stay as they are. Rename the file header from "Forest and brass" to "Leonid · Midnight".

### 2. Fonts: `apps/web/index.html`

Replace the Geist link with:
`https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500;600&display=swap`

### 3. Mark, favicon, social card

- `apps/web/src/ui/BrandMark.tsx`: replace the hexagon with the meteor. The one-color version (it keeps `currentColor`, so the existing CSS colors it):
  `<path d="M26.5 5.5 10.4 19.6 12.6 21.8Z"/><circle cx="10.6" cy="21.4" r="3.4"/>` on a `0 0 32 32` viewBox.
- Copy `docs/brand/assets/favicon.svg` to `apps/web/public/favicon.svg` and add `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` to `index.html`. Today there is no favicon at all.
- Social card: `docs/brand/assets/social-card.png` (1200×630), made from `social-card.html`. Put it in `apps/web/public/` and add `og:title` "Leonid", `og:description` "Every event, on course.", `og:image`.

### 4. The name in the product: done

Every user-visible place says Leonid, and the agent is Leo ("Ask Leo"). The old working name was dropped from the whole repo on Nov 9, 2026: package names (`@leonid/*`), imports, CSS class prefix (`lx-`), browser storage keys (`leonid.*`), the PayPal `custom_id` tag prefix (`leonid:`), docs and scripts. The root `package.json` and `render.yaml` name the service `leonid`.

## What still carries the old name, and why

- **The staging address `quartermaster-staging.onrender.com`.** Render fixes an address when a service is created and cannot change it, and PayPal has it registered (both webhooks and the Log in with PayPal return URL). The service's display name in the Render dashboard is `leonid-staging`. A new address would mean a new service and re-registering all of that; a custom domain in front of the service is the way to a clean address.
- **The reader of old payment tags** (`webhooks/handlers/capture-completed.ts`, `TAG`). It accepts both `leonid:` and the earlier `qm:` prefix, so a ticket or donation checkout started before the rename and paid after it is still recorded. New tags are written as `leonid:`. Remove the `qm:` alternative once no old checkout can still be paid.
- **Binary and historical files:** `docs/PRD.pdf`, and dated log rows in the README that record what was asked at the time.
- **Saved browser data:** the storage keys were renamed, so a browser that used the app earlier forgets its saved chats once.

## Cut 2, if time allows

- The meteor streak motif on the landing hero (`landing/sections.tsx` `HeroVisual`, the comment there already says "swap HeroVisual for the new mark or motif once the name is decided"), the sponsor report header and empty states.
- Leo's voice in empty and error states (examples in the design system README: "Nothing waiting for you. Spends over your limits will show up here.").
- A chart series palette in `studio-theme.ts` from `chart-1..3`.

## Files here

- `assets/leonid-mark.svg`, `assets/leonid-mark-mono.svg`, `assets/favicon.svg`
- `assets/social-card.html` and `assets/social-card.png` (1200×630)
