import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

vi.mock('../chat/AgentChat', () => ({ AgentChat: () => null }));

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const meetup = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Spring Meetup',
  date: '2099-05-20',
  people: 80,
  budget: 150_000,
  currency: 'USD',
};
const hack = { ...meetup, id: '22222222-2222-4222-8222-222222222222', name: 'Autumn Hack' };

const summary = (event: string, venue: string) => ({
  event: { name: event, date: '2099-05-20T00:00:00.000Z', headcount: 80, maxSpend: null },
  venue: {
    name: venue,
    area: 'Jakarta',
    includes: ['Wi-Fi'],
    catering: 'unknown',
    sourceUrl: 'https://example.com/v',
  },
  estimate: { lines: [{ label: 'Hall', amountMinor: 1_600_000 }], total: 1_600_000, currency: 'IDR' },
  fx: { from: 'IDR', localMinorPerUsd: 16_000 },
  payable: { amountMinor: 10_000, currency: 'USD' },
  overMaxSpend: false,
});
const plans = [
  {
    threadId: '33333333-3333-4333-8333-333333333333',
    eventId: meetup.id,
    updatedAt: '2099-01-01T00:00:00.000Z',
    summary: summary('Spring Meetup', 'Hall A'),
    payment: { status: 'unpaid' },
  },
  {
    threadId: '44444444-4444-4444-8444-444444444444',
    eventId: hack.id,
    updatedAt: '2099-01-02T00:00:00.000Z',
    summary: summary('Autumn Hack', 'Hall B'),
    payment: { status: 'paid', reference: 'CAP-1' },
  },
];

function stub(historyStatus: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/events') return json({ events: [meetup, hack] });
      if (url === '/api/venue-booking') return json({ plans }, historyStatus);
      const plan = plans.find((p) => url.endsWith(p.threadId));
      if (plan) return json({ summary: plan.summary, payment: plan.payment });
      return new Promise(() => {});
    }),
  );
}

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('History', () => {
  it('is in the sidebar below All events', async () => {
    stub(200);
    open('/events');
    expect(await screen.findByRole('link', { name: 'History' })).toHaveAttribute('href', '/history');
  });

  it('groups plans into to pay and paid, and a row opens the plan', async () => {
    stub(200);
    open('/history');
    expect(await screen.findByRole('heading', { name: 'To pay (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Paid (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Autumn Hack at Hall B/ }));
    expect(await screen.findByText(/PayPal reference/)).toBeInTheDocument();
  });

  it('asks to sign in when the server says 401', async () => {
    stub(401);
    open('/history');
    expect(await screen.findByText(/Sign in as treasurer/)).toBeInTheDocument();
  });
});
