import { describe, expect, it } from 'vitest';
import type { PlanResponse, PlanTaskRow } from '@leonid/shared';
import type { PlanSponsor } from '../plan/gating';
import { calendarDate, eventDayRange, planSummary, toPlanEvents } from './planEvents';

const task = (n: number, name: string, start: string, end: string): PlanTaskRow => ({
  id: `0f1a5c2e-0000-4a6b-9c3d-00000000000${n}`,
  name,
  start,
  end,
  deadline: null,
  dependsOn: [],
  fundedBySponsorId: null,
  invoiceOfSponsorId: null,
});

const plan: PlanResponse = {
  eventDate: '2027-03-14T00:00:00.000Z',
  tasks: [
    task(1, 'Print badges', '2027-03-08T00:00:00.000Z', '2027-03-10T00:00:00.000Z'),
    task(2, 'Registration desk', '2027-03-14T08:00:00.000Z', '2027-03-14T10:30:00.000Z'),
    task(3, 'Venue deposit', '2027-03-01T00:00:00.000Z', '2027-03-01T23:59:59.000Z'),
    task(4, 'Doors open', '2027-03-14T00:00:00.000Z', '2027-03-14T00:00:00.000Z'),
  ],
};
const now = new Date('2027-03-05T00:00:00.000Z');

describe('toPlanEvents', () => {
  const [badges, desk, deposit, doors] = toPlanEvents(plan, now);

  it('hands times over as UTC wall-clock strings with no zone', () => {
    expect(desk).toMatchObject({
      startDate: '2027-03-14T08:00:00',
      endDate: '2027-03-14T10:30:00',
      allDay: false,
    });
  });

  it('makes a multi-day task an all-day event that ends at an exclusive midnight', () => {
    expect(badges).toMatchObject({
      allDay: true,
      startDate: '2027-03-08T00:00:00',
      endDate: '2027-03-10T00:00:00',
    });
  });

  it('rounds a same-day task that ends at 23:59:59, and a midnight milestone, up to one whole day', () => {
    expect(deposit).toMatchObject({
      allDay: true,
      startDate: '2027-03-01T00:00:00',
      endDate: '2027-03-02T00:00:00',
    });
    expect(doors).toMatchObject({
      allDay: true,
      startDate: '2027-03-14T00:00:00',
      endDate: '2027-03-15T00:00:00',
    });
  });

  it('tags each event with its status class for the theme', () => {
    expect(deposit?.cls).toBe('lx-status-done');
    expect(badges?.cls).toBe('lx-status-pending');
  });
});

describe('calendar helpers', () => {
  it('spans the event day for the highlight and opens the calendar on that date', () => {
    expect(eventDayRange(plan.eventDate)).toMatchObject({
      startDate: '2027-03-14T00:00:00',
      endDate: '2027-03-15T00:00:00',
    });
    const date = calendarDate(plan.eventDate);
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2027, 2, 14]);
  });

  it('counts late or at-risk tasks and names the next two that are not done', () => {
    const summary = planSummary([
      { name: 'A', status: 'done' },
      { name: 'B', status: 'blocked' },
      { name: 'C', status: 'risk' },
      { name: 'D', status: 'pending' },
    ]);
    expect(summary).toEqual({ flagged: 2, next: ['B', 'C'] });
  });
});

describe('sponsors', () => {
  const HARBOR = '0f1a5c2e-1111-4a6b-9c3d-000000000001';
  const LUMEN = '0f1a5c2e-1111-4a6b-9c3d-000000000002';
  const sponsors: PlanSponsor[] = [
    { id: HARBOR, name: 'Harbor Cloud', status: 'paid' },
    { id: LUMEN, name: 'Lumen Labs', status: 'invoiced' },
  ];
  const sponsored: PlanResponse = {
    eventDate: plan.eventDate,
    tasks: [
      {
        ...task(1, 'Invoice Harbor Cloud', '2027-03-20T00:00:00.000Z', '2027-03-21T00:00:00.000Z'),
        invoiceOfSponsorId: HARBOR,
      },
      {
        ...task(2, 'Invoice Lumen Labs', '2027-03-20T00:00:00.000Z', '2027-03-21T00:00:00.000Z'),
        invoiceOfSponsorId: LUMEN,
      },
      {
        ...task(3, 'Order lanyards', '2027-03-20T00:00:00.000Z', '2027-03-21T00:00:00.000Z'),
        fundedBySponsorId: HARBOR,
      },
      {
        ...task(4, 'Book catering', '2027-03-20T00:00:00.000Z', '2027-03-21T00:00:00.000Z'),
        fundedBySponsorId: LUMEN,
      },
    ],
  };
  const [harbor, lumen, lanyards, catering] = toPlanEvents(sponsored, now, sponsors);

  it('makes a sponsor’s invoice task follow that sponsor’s status, whatever the dates say', () => {
    expect(harbor?.status).toBe('done');
    expect(lumen?.status).toBe('progress');
    expect(toPlanEvents(sponsored, now, [])[0]?.status).toBe('pending');
  });

  it('says which sponsor funds a purchase and whether they have paid, and nothing for other tasks', () => {
    expect(lanyards?.funding).toBe('Harbor Cloud · paid');
    expect(catering?.funding).toBe('Lumen Labs · not paid yet');
    expect(harbor?.funding).toBe('');
  });
});
