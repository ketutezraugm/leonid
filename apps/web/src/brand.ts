// The product's name and public links, in one place. The team may rename the product, so nothing else
// should spell the name: screens and the landing page read it from here, and a rename is a one-line change.
// (Test files, the PRD and the repo name still say Quartermaster; they follow the decision, not this file.)
export const BRAND = {
  name: 'Quartermaster',
} as const;

// Public links shown on the landing page. A link that is null is not shown: never invent a URL.
export const LINKS = {
  github: 'https://github.com/harfiibadurahman01-del/paypal-hack',
  video: null as string | null,
} as const;

// Sections of the landing page that describe features still being built. Turn one off here if the feature
// does not ship, so the page never promises what the demo cannot show.
export const LANDING = {
  /** "Pays people back from a phone": claims, prize payouts, speaker reimbursements (F16, F17: Upgrade tier). */
  showPayouts: true,
  /** "Can I run more than one event?": stays off until approvals and rules are scoped per event on the server. */
  showMultiEvent: false,
} as const;
