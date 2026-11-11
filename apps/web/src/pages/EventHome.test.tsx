import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsProvider } from '../shell/event';
import { EventHome } from './EventHome';

// Bryntum Calendar needs a real browser layout; the strip's own test covers what it is given.
vi.mock('../home/BryntumPlanCalendar', () => ({ default: () => null }));

const AS_OF = '2027-01-26T12:00:00.000Z';

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

// Every feed the dashboard reads, answered with one row each, so each section shows a live figure and never a sample.
const answers: Record<string, unknown> = {
  '/api/treasury': {
    merchantId: 'M1',
    asOf: AS_OF,
    balances: [{ currency: 'USD', totalMinor: 412_000, availableMinor: 412_000, withheldMinor: 0 }],
  },
  '/api/widgets/funding': {
    source: 'live',
    data: {
      asOf: AS_OF,
      currency: 'USD',
      sponsors: [],
      totals: { pledged: 800_000, invoiced: 550_000, cleared: 300_000 },
    },
  },
  '/api/widgets/budget-burn': {
    source: 'live',
    data: {
      asOf: AS_OF,
      currency: 'USD',
      eventDate: '2027-03-14',
      daysToEvent: 47,
      clearedIncome: 300_000,
      committed: 186_000,
      unlocked: 114_000,
      categories: [],
    },
  },
  '/api/widgets/delivery-risk': {
    source: 'live',
    data: {
      asOf: AS_OF,
      items: [
        {
          orderId: '0f1a5c2e-1111-4a6b-9c3d-000000000001',
          taskId: null,
          name: 'Lanyards (200)',
          sponsorId: null,
          category: 'swag',
          trackingNumber: null,
          expectedDelivery: '2027-03-09',
          deadline: '2027-03-07',
          daysLate: 2,
          risk: 'late',
        },
      ],
    },
  },
  '/api/sponsors': {
    sponsors: [
      {
        id: '0f1a5c2e-2222-4a6b-9c3d-000000000002',
        eventId: '0f1a5c2e-3333-4a6b-9c3d-000000000003',
        name: 'Lumen Labs',
        tier: 'Silver',
        pledged: 250_000,
        currency: 'USD',
        paypalInvoiceId: 'INV2-1',
        status: 'invoiced',
      },
    ],
  },
  '/api/spends/recent': { spends: [] },
  '/api/events/demo/plan': {
    eventDate: '2027-03-14T00:00:00.000Z',
    tasks: [
      {
        id: '0f1a5c2e-4444-4a6b-9c3d-000000000004',
        name: 'Order lanyards',
        start: '2027-03-08T00:00:00.000Z',
        end: '2027-03-10T00:00:00.000Z',
        deadline: null,
        dependsOn: [],
        fundedBySponsorId: null,
        invoiceOfSponsorId: null,
        kind: 'task',
        workstream: null,
      },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('EventHome', () => {
  it('shows the live balance, alerts, spends and plan for the event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const path = String(url).split('?')[0] ?? '';
        if (path === '/api/events') return json({ error: 'not found' }, 404);
        return path in answers ? json(answers[path]) : new Promise(() => {});
      }),
    );
    render(
      <MemoryRouter initialEntries={['/events/demo/home']}>
        <EventsProvider>
          <EventHome />
        </EventsProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('$4,120.00')).toBeInTheDocument();
    expect(await screen.findByText(/Lanyards \(200\) arrives Mar 9/)).toBeInTheDocument();
    expect(screen.getByText(/Lumen Labs has been invoiced \$2,500.00/)).toBeInTheDocument();
    expect(await screen.findByText(/No spends yet/)).toBeInTheDocument();
    expect(await screen.findByText(/Next: Order lanyards/)).toBeInTheDocument();
    expect(screen.queryByText(/Sample/)).not.toBeInTheDocument();
  });
});
