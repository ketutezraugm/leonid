import { and, desc, eq, sql } from 'drizzle-orm';
import type { UIMessage } from 'ai';
import {
  venueEstimate,
  type BookingPayment,
  type VenueBookingSummary,
} from '@leonid/shared';
import { venuePickOf } from '../agents/venuePick.js';
import type { Db } from '../db/client.js';
import { getEvent } from '../db/events.js';
import { approvals, auditLog } from '../db/schema.js';
import { LOCAL_MINOR_PER_USD, isFxCurrency, toUsdCents } from '../pricing/fx.js';
import { findListing, listingUrl, type VenueListing } from '../search/venueCatalog.js';

// The venue the organizer picked in this chat, if it is a seeded catalog venue the scout really returned.
export function pickedListing(messages: readonly UIMessage[]): VenueListing | null {
  const pick = venuePickOf(messages);
  const listing = pick && findListing(pick.sourceUrl);
  return listing && listing.name === pick.name ? listing : null;
}

// One booking per venue per chat: PayPal's idempotency key comes from this, so a second click replays the first spend.
export const bookingReference = (threadId: string, listing: VenueListing) =>
  `venue-booking-${threadId}-${listing.id}`;

// The plan for a picked venue, worked out by code from the event row, the catalog and the demo exchange rate.
export async function bookingSummary(
  db: Db,
  listing: VenueListing,
  eventId: string | null,
): Promise<VenueBookingSummary | null> {
  const event = eventId ? await getEvent(db, eventId) : undefined;
  if (!event || !isFxCurrency(listing.price.currency)) return null;
  const estimate = venueEstimate(listing, event.headcount);
  if (!estimate) return null;
  const payableMinor = toUsdCents(estimate.total, listing.price.currency);
  const maxSpend =
    event.maxSpendMinor === null
      ? null
      : { amountMinor: event.maxSpendMinor, currency: event.currency };
  return {
    event: {
      name: event.name,
      date: event.date.toISOString(),
      headcount: event.headcount,
      maxSpend,
    },
    venue: {
      name: listing.name,
      area: `${listing.area}, ${listing.city}`,
      includes: listing.terms.includes,
      catering: listing.catering,
      sourceUrl: listingUrl(listing),
    },
    estimate: { ...estimate, currency: listing.price.currency },
    fx: {
      from: listing.price.currency,
      localMinorPerUsd: LOCAL_MINOR_PER_USD[listing.price.currency],
    },
    payable: { amountMinor: payableMinor, currency: 'USD' },
    // check() compares in one currency only, so the early warning does too.
    overMaxSpend:
      maxSpend !== null && maxSpend.currency === 'USD' && payableMinor > maxSpend.amountMinor,
  };
}

// Whether this booking was paid, read from the approval the rules made for it, or from the audit row of a wallet charge.
// Read from our own records, never from the browser or the agent.
export async function bookingPayment(db: Db, referenceId: string): Promise<BookingPayment> {
  const [approval] = await db
    .select()
    .from(approvals)
    .where(sql`${approvals.spend}->>'referenceId' = ${referenceId}`)
    .orderBy(desc(approvals.createdAt))
    .limit(1);
  if (approval?.status === 'paid') {
    return { status: 'paid', reference: approval.paypalOrderId ?? approval.id };
  }
  if (approval?.status === 'pending' || approval?.status === 'capturing') {
    return {
      status: 'awaiting_approval',
      approvalId: approval.id,
      paypalOrderId: approval.status === 'pending' ? (approval.paypalOrderId ?? undefined) : undefined,
    };
  }
  const [charge] = await db
    .select({ paypalId: auditLog.paypalId })
    .from(auditLog)
    .where(and(sql`${auditLog.input}->>'referenceId' = ${referenceId}`, eq(auditLog.outcome, 'paid')))
    .limit(1);
  return charge ? { status: 'paid', reference: charge.paypalId ?? referenceId } : { status: 'unpaid' };
}

const usd = (minor: number) => `USD ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

// The booking plan as a block for the orchestrator's instructions, so it can answer questions about it. Every figure
// comes from bookingSummary and bookingPayment, never from the model.
export function bookingPlanLine(summary: VenueBookingSummary, payment: BookingPayment): string {
  const { event, venue, estimate, payable } = summary;
  const local = (minor: number) =>
    `${estimate.currency} ${(estimate.currency === 'IDR' ? minor : minor / 100).toLocaleString('en-US')}`;
  const status = {
    paid: `PAID with PayPal (reference ${payment.status === 'paid' ? payment.reference : ''})`,
    awaiting_approval: 'not paid yet: waiting for the treasurer to approve it in PayPal',
    unpaid: 'not paid yet: the organizer is reading the plan and has not agreed to pay',
  }[payment.status];
  return [
    'The booking plan the organizer sees in the results panel (computed by code; answer questions about it from these facts and say if something is not here):',
    `- Event: ${event.name}, ${event.date.slice(0, 10)}, ${event.headcount} people.`,
    `- Venue: ${venue.name}, ${venue.area}. Includes: ${venue.includes.join(', ')}. Catering: ${venue.catering === 'yes' ? 'mentioned on its page' : venue.catering === 'no' ? 'not included' : 'not stated'}.`,
    `- One-day cost: ${estimate.lines.map((l) => `${l.label} ${local(l.amountMinor)}`).join('; ')}; total ${local(estimate.total)}.`,
    `- To pay: ${usd(payable.amountMinor)} (converted at a demo exchange rate). Status: ${status}.`,
    'You cannot pay, refund or change this plan; the organizer pays it from the panel.',
  ].join('\n');
}
