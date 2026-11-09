import { describe, expect, it } from 'vitest';
import type { VenueBookingSummary } from '@quartermaster/shared';
import { bookingPlanLine } from './venueBooking.js';

const summary: VenueBookingSummary = {
  event: { name: 'OpenHack 2027', date: '2027-03-14T09:00:00.000Z', headcount: 200, maxSpend: null },
  venue: {
    name: 'Aula Bhinneka',
    area: 'West Jakarta, Jakarta',
    includes: ['Stage', 'Sound system'],
    catering: 'no',
    sourceUrl: 'https://venues.example/id/jakarta/aula',
  },
  estimate: {
    lines: [
      { label: '1 day', amountMinor: 19_300_000 },
      { label: 'Cleaning fee', amountMinor: 920_000 },
    ],
    total: 20_220_000,
    currency: 'IDR',
  },
  fx: { from: 'IDR', localMinorPerUsd: 16_000 },
  payable: { amountMinor: 126_375, currency: 'USD' },
  overMaxSpend: false,
};

describe('bookingPlanLine', () => {
  it('gives the agent the plan, the USD total and whether it is paid, all from code', () => {
    const line = bookingPlanLine(summary, { status: 'unpaid' });
    expect(line).toContain('OpenHack 2027, 2027-03-14, 200 people');
    expect(line).toContain('Aula Bhinneka, West Jakarta, Jakarta. Includes: Stage, Sound system. Catering: not included');
    expect(line).toContain('total IDR 20,220,000');
    expect(line).toContain('To pay: USD 1,263.75');
    expect(line).toContain('not paid yet: the organizer is reading the plan');
  });

  it('says when it is paid, with the PayPal reference', () => {
    expect(bookingPlanLine(summary, { status: 'paid', reference: 'ORD-1' })).toContain(
      'PAID with PayPal (reference ORD-1)',
    );
  });

  it('says when it waits for the treasurer', () => {
    expect(
      bookingPlanLine(summary, { status: 'awaiting_approval', approvalId: 'a1' }),
    ).toContain('waiting for the treasurer');
  });
});
