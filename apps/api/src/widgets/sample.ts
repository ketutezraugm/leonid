import {
  DeliveryRiskData,
  PayoutsLedgerData,
  type DeliveryRisk,
  type DeliveryRiskItem,
  type RuleResult,
  type WidgetFilter,
} from '@leonid/shared';
import type { Db } from '../db/client.js';
import { getEvent, listSponsors } from '../db/events.js';

// SAMPLE data for the command-center widgets whose real inputs do not exist yet. Every response built
// here is served with source 'sample', so the command center must label it.
//   - delivery risk  waits on P4's orders and tracking
//   - payouts ledger waits on F17's payouts table
// When the real data lands, replace the function behind the same endpoint and flip the source to 'live'.

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;

// An item with this many days or fewer to spare is at risk, not safely on track. This is P3's working
// definition for the sample; P4 owns the real one and should confirm or replace it.
export const AT_RISK_SLACK_DAYS = 2;

// Late: expected after the deadline. At risk: on time with no more than AT_RISK_SLACK_DAYS to spare.
// On track: more slack than that. Unknown: tracking has given no date yet (daysLate is then 0).
export function assessDelivery(
  expectedDelivery: string | null,
  deadline: string,
): { daysLate: number; risk: DeliveryRisk } {
  if (!expectedDelivery) return { daysLate: 0, risk: 'unknown' };
  const daysLate = dayNumber(expectedDelivery) - dayNumber(deadline);
  if (daysLate > 0) return { daysLate, risk: 'late' };
  return { daysLate, risk: daysLate >= -AT_RISK_SLACK_DAYS ? 'at_risk' : 'on_track' };
}

// P4's late-swag story: lanyards land two days after badge printing. The swag items are funded by the
// gold sponsor and the prize cart by the silver one, using the event's real sponsor ids so a click on a
// sponsor filters this widget together with the live funding thermometer.
const SAMPLE_ORDERS = [
  {
    name: 'Lanyards (200)',
    tier: 'gold',
    category: 'swag',
    tracking: 'SAMPLE-TRK-1',
    expected: '2027-03-09',
    deadline: '2027-03-07',
  },
  {
    name: 'Prize trophies',
    tier: 'silver',
    category: 'prizes',
    tracking: 'SAMPLE-TRK-2',
    expected: '2027-03-06',
    deadline: '2027-03-07',
  },
  {
    name: 'USB-C adapters',
    tier: 'gold',
    category: 'swag',
    tracking: 'SAMPLE-TRK-3',
    expected: '2027-03-02',
    deadline: '2027-03-07',
  },
  {
    name: 'Snacks',
    tier: null,
    category: 'food',
    tracking: null,
    expected: null,
    deadline: '2027-03-13',
  },
] as const;

// Delivery risk for one event, filtered by sponsor and category. The items are sample.
// Returns undefined when the event does not exist.
export async function getDeliveryRiskSample(
  db: Db,
  eventId: string,
  filter: WidgetFilter = {},
  now: Date = new Date(),
): Promise<DeliveryRiskData | undefined> {
  const event = await getEvent(db, eventId);
  if (!event) return undefined;
  const sponsors = await listSponsors(db, eventId);
  const items: DeliveryRiskItem[] = SAMPLE_ORDERS.map((o, i) => ({
    orderId: `sample-order-${i + 1}`,
    taskId: `sample-task-${i + 1}`,
    name: o.name,
    sponsorId: o.tier ? (sponsors.find((s) => s.tier === o.tier)?.id ?? null) : null,
    category: o.category,
    trackingNumber: o.tracking,
    expectedDelivery: o.expected,
    deadline: o.deadline,
    ...assessDelivery(o.expected, o.deadline),
  })).filter(
    (item) =>
      (!filter.sponsorId || item.sponsorId === filter.sponsorId) &&
      (!filter.category || item.category === filter.category),
  );
  return DeliveryRiskData.parse({ asOf: now.toISOString(), items });
}

// Prize winners and one volunteer claim, until F17's payouts exist. They use the event's real sponsor ids
// (gold funds the first prize, silver the second) so a click on a sponsor filters the payouts ledger together
// with the live funding thermometer, and the categories match the other two samples. Nothing here moves or
// asks to move money: it is a list of made-up rows for a screen.
const SAMPLE_PAYOUTS: readonly {
  name: string;
  kind: 'claim' | 'prize';
  tier: 'gold' | 'silver' | null;
  category: string;
  amount: number;
  country: string;
  email: string;
  status: 'queued' | 'pending_approval' | 'paid';
  note: string;
  ruleResult: RuleResult | null;
}[] = [
  {
    name: 'Ada Winner',
    kind: 'prize',
    tier: 'gold',
    category: 'prizes',
    amount: 50_000,
    country: 'GB',
    email: 'ada@example.com',
    status: 'queued',
    note: 'First place',
    ruleResult: null,
  },
  {
    name: 'Ravi Winner',
    kind: 'prize',
    tier: 'silver',
    category: 'prizes',
    amount: 30_000,
    country: 'IN',
    email: 'ravi@example.com',
    status: 'pending_approval',
    note: 'Second place',
    ruleResult: {
      decision: 'needs_approval',
      reasons: ['Payout over $200'],
      ruleIds: ['payout-threshold'],
    },
  },
  {
    name: 'Sam Volunteer',
    kind: 'claim',
    tier: null,
    category: 'food',
    amount: 4_250,
    country: 'US',
    email: 'sam@example.com',
    status: 'paid',
    note: 'Pizza for volunteers',
    ruleResult: {
      decision: 'allow',
      reasons: ['Under the $50 per day claim cap'],
      ruleIds: ['claim-daily-cap'],
    },
  },
];

// The payouts ledger for one event, filtered by sponsor and category. The rows are sample.
// Returns undefined when the event does not exist.
export async function getPayoutsLedgerSample(
  db: Db,
  eventId: string,
  filter: WidgetFilter = {},
  now: Date = new Date(),
): Promise<PayoutsLedgerData | undefined> {
  const event = await getEvent(db, eventId);
  if (!event) return undefined;
  const sponsors = await listSponsors(db, eventId);
  const at = now.toISOString();
  const rows = SAMPLE_PAYOUTS.map((p, i) => {
    const paid = p.status === 'paid';
    return {
      id: `sample-payout-${i + 1}`,
      eventId,
      payoutId: paid ? 'sample-batch-1' : null,
      kind: p.kind,
      recipientName: p.name,
      destination: { recipientType: 'EMAIL' as const, receiver: p.email, countryCode: p.country },
      amount: p.amount,
      currency: event.currency,
      category: p.category,
      sponsorId: p.tier ? (sponsors.find((s) => s.tier === p.tier)?.id ?? null) : null,
      claimId: p.kind === 'claim' ? 'sample-claim-1' : null,
      note: p.note,
      senderItemId: `sample-payout-${i + 1}`,
      paypalItemId: paid ? 'PI-SAMPLE-1' : null,
      status: p.status,
      ruleResult: p.ruleResult,
      updatedAt: at,
    };
  }).filter(
    (row) =>
      (!filter.sponsorId || row.sponsorId === filter.sponsorId) &&
      (!filter.category || row.category === filter.category),
  );
  return PayoutsLedgerData.parse({ asOf: at, rows });
}
