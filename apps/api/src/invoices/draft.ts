import { InvoiceDraft } from '@quartermaster/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { events, sponsors } from '../db/schema.js';

export const DEFAULT_DUE_IN_DAYS = 14;

export interface DraftSponsor {
  id: string;
  name: string;
  tier: string;
  pledged: number;
}

export interface DraftEvent {
  name: string;
  currency: string;
}

// The baseline draft: invoice the whole pledge as one line, due in two weeks. Deterministic on purpose,
// so the treasurer sees the same draft every time and the amount can never come from model output.
// The text the sponsor reads uses only our own event name and tier, never free text from outside.
export function buildSponsorInvoiceDraft(sponsor: DraftSponsor, event: DraftEvent): InvoiceDraft {
  if (!Number.isSafeInteger(sponsor.pledged) || sponsor.pledged <= 0) {
    throw new RangeError(`${sponsor.name} has no pledge to invoice`);
  }
  const major = (sponsor.pledged / 100).toFixed(2);
  return InvoiceDraft.parse({
    sponsorId: sponsor.id,
    items: [
      {
        name: `${event.name} ${sponsor.tier} sponsorship`.slice(0, 200),
        quantity: 1,
        unitAmount: sponsor.pledged,
      },
    ],
    currency: event.currency,
    dueInDays: DEFAULT_DUE_IN_DAYS,
    note: `Thank you for sponsoring ${event.name}. This invoice covers the ${sponsor.tier} sponsorship you pledged.`,
    reasoning: `Invoice the full ${sponsor.tier} pledge of ${major} ${event.currency} as one line, due ${DEFAULT_DUE_IN_DAYS} days after it is sent.`,
  });
}

export async function loadSponsorWithEvent(db: Db, sponsorId: string) {
  const [sponsor] = await db.select().from(sponsors).where(eq(sponsors.id, sponsorId));
  if (!sponsor) return undefined;
  const [event] = await db.select().from(events).where(eq(events.id, sponsor.eventId));
  if (!event) return undefined;
  return { sponsor, event };
}

export async function draftForSponsor(db: Db, sponsorId: string) {
  const found = await loadSponsorWithEvent(db, sponsorId);
  if (!found) return undefined;
  return { ...found, draft: buildSponsorInvoiceDraft(found.sponsor, found.event) };
}
