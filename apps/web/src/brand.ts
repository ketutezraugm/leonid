// The product's name and public links, in one place. Screens and the landing page read it from here, so a
// rename is a one-line change. The brand is described in docs/brand/BRAND.md.
// (The staging address still starts with the service's first name: Render fixes an address when the service is
// created and PayPal has it registered, so it stays.)
export const BRAND = {
  name: 'Leonid',
} as const;

// Public links shown on the landing page. A link that is null is not shown: never invent a URL.
export const LINKS = {
  github: 'https://github.com/ketutezraugm/paypal-hack-1',
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
