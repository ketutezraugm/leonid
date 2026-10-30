import {
  BudgetBurnData,
  DeliveryRiskData,
  type DeliveryRisk,
  type DeliveryRiskItem,
  type WidgetFilter,
} from '@quartermaster/shared';
import type { Db } from '../db/client.js';
import { getEvent, listSponsors } from '../db/events.js';

// SAMPLE data for the two command-center widgets whose real inputs do not exist yet. Every response built
// here is served with source 'sample', so the command center must label it. Nothing in this file reads
// money from the ledger on purpose: mixing real cleared income with a made-up commitment would produce an
// "unlocked budget" that looks real and is not.
//   - budget burn  waits on P1's funds-gated budget (committed spend and per-category caps)
//   - delivery risk waits on P4's orders and tracking
// When the real data lands, replace the function behind the same endpoint and flip the source to 'live'.

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;

// The same numbers as P4's mockups, so the screens and this sample agree: cleared $3,000.00, committed
// $1,860.00, unlocked $1,140.00, and category caps that add up to the $8,000.00 budget.
const SAMPLE_CLEARED_INCOME = 300_000;
const SAMPLE_CATEGORIES = [
  { category: 'venue', cap: 250_000, spent: 130_000, committed: 0 },
  { category: 'swag', cap: 150_000, spent: 14_000, committed: 0 },
  { category: 'prizes', cap: 200_000, spent: 0, committed: 42_000 },
  { category: 'food', cap: 100_000, spent: 0, committed: 0 },
  { category: 'av', cap: 60_000, spent: 0, committed: 0 },
  { category: 'travel', cap: 40_000, spent: 0, committed: 0 },
];

// Budget burn for one event. The event's own facts (currency, date, days to go) are real; every money
// figure is sample. The totals stay event-wide whatever the filter says, because unlocked budget is one
// number for the whole event; only the category list narrows. A sponsor filter means nothing here.
// Returns undefined when the event does not exist.
export async function getBudgetBurnSample(
  db: Db,
  eventId: string,
  filter: WidgetFilter = {},
  now: Date = new Date(),
): Promise<BudgetBurnData | undefined> {
  const event = await getEvent(db, eventId);
  if (!event) return undefined;
  const eventDate = event.date.toISOString().slice(0, 10);
  const committed = SAMPLE_CATEGORIES.reduce((sum, c) => sum + c.spent + c.committed, 0);
  return BudgetBurnData.parse({
    asOf: now.toISOString(),
    currency: event.currency,
    eventDate,
    daysToEvent: dayNumber(eventDate) - Math.floor(now.getTime() / DAY_MS),
    clearedIncome: SAMPLE_CLEARED_INCOME,
    committed,
    unlocked: SAMPLE_CLEARED_INCOME - committed,
    categories: SAMPLE_CATEGORIES.filter((c) => !filter.category || c.category === filter.category),
  });
}

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
