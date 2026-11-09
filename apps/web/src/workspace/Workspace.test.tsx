import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from './Workspace';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const scoutPart = (id: string, city: string, candidates: object[]) => ({
  type: 'tool-delegate_to_venue_scout',
  toolCallId: id,
  state: 'output-available',
  input: { city, headcount: 30 },
  output: { activity: [], candidates, summary: `Found ${candidates.length} in ${city}.` },
});

const hall = {
  name: 'Harbor Hall',
  area: 'Central',
  sourceUrls: ['https://harbor.example/rooms'],
  capacity: { value: 40, quote: 'up to 40 people' },
  price: { amountMinor: 2_500_000, currency: 'IDR', per: 'package', quote: 'Rp 2.500.000' },
  cateringIncluded: 'yes',
  booking: 'whatsapp',
};
const loft = {
  name: 'Tiny Loft',
  sourceUrls: ['https://loft.example'],
  capacity: { value: 12, quote: '12 seats' },
  price: null,
  cateringIncluded: 'unknown',
  booking: 'website',
};

function stubThread(parts: object[], after: object[] = []) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
    if (url === '/api/chat/threads/lookup') {
      return Promise.resolve(Response.json({ threads: [], demoEvent: null }));
    }
    return Promise.resolve(
      Response.json({
        messages: [
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Find venues' }] },
          { id: 'a1', role: 'assistant', parts },
          ...after,
        ],
        checklist: [],
        event: null,
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Workspace', () => {
  it('shows the idle canvas before any search', async () => {
    stubThread([]);
    render(<Workspace />);
    expect(
      screen.getByRole('heading', { name: 'What the agent finds shows up here' }),
    ).toBeInTheDocument();
  });

  it('opens the newest venue search on the canvas, with sorting and filters', async () => {
    stubThread([scoutPart('s1', 'Jakarta', [loft, hall])]);
    render(<Workspace />);

    const canvas = await screen.findByRole('region', { name: 'Results' });
    expect(
      await within(canvas).findByRole('heading', { name: 'Venues in Jakarta' }),
    ).toBeInTheDocument();
    expect(within(canvas).getByText('2 venues found')).toBeInTheDocument();

    // Best fit puts the venue that holds all 30 people first.
    const names = () =>
      within(canvas)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent);
    expect(names()).toEqual(['Harbor Hall', 'Tiny Loft']);
    expect(within(canvas).getByText('Up to 12 people (too small)')).toBeInTheDocument();
    expect(within(canvas).getByText('Price on request')).toBeInTheDocument();

    fireEvent.click(within(canvas).getByRole('checkbox', { name: /Price listed/ }));
    expect(names()).toEqual(['Harbor Hall']);

    const source = within(canvas).getByRole('link', { name: 'View source' });
    expect(source).toHaveAttribute('href', 'https://harbor.example/rooms');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');

    // The chat card says which search the canvas is showing.
    const chat = screen.getByRole('region', { name: 'Agent chat' });
    expect(within(chat).getByText('Viewing')).toBeInTheDocument();
  });

  it('shows a one-day estimate and what the price covers for a seeded venue', async () => {
    const seeded = {
      ...hall,
      price: { amountMinor: 30_000_000, currency: 'IDR', per: 'day', quote: 'Rp 30.000.000' },
      terms: {
        minPax: null,
        minHours: null,
        includes: ['Whole hall for the day, empty floor'],
        addOns: [
          { name: 'Banquet chair', amountMinor: 20_000, unit: 'person', required: true },
          { name: 'Sound system', amountMinor: 4_000_000, unit: 'event', required: false },
        ],
        taxPercent: 0,
      },
    };
    stubThread([scoutPart('s1', 'Jakarta', [seeded])]);
    render(<Workspace />);
    const canvas = screen.getByRole('region', { name: 'Results' });
    await within(canvas).findByRole('heading', { name: 'Venues in Jakarta' });

    // 30 people at Rp 20,000 a chair, on top of the hall.
    expect(within(canvas).getAllByText('IDR 30,600,000').length).toBeGreaterThan(0);
    expect(within(canvas).getByText('Estimate for 30 people, 1 day')).toBeInTheDocument();
    expect(within(canvas).getByText('Whole venue hire')).toBeInTheDocument();
    expect(within(canvas).getByText('Banquet chair x 30')).toBeInTheDocument();
    expect(within(canvas).getByText('Banquet chair (required)')).toBeInTheDocument();
    expect(within(canvas).getByText('Sound system (optional)')).toBeInTheDocument();
  });

  it('switches the canvas to an earlier search picked in the chat', async () => {
    stubThread([scoutPart('s1', 'Bandung', [hall]), scoutPart('s2', 'Jakarta', [loft])]);
    render(<Workspace />);

    const canvas = await screen.findByRole('region', { name: 'Results' });
    expect(
      await within(canvas).findByRole('heading', { name: 'Venues in Jakarta' }),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'View results' }));
    expect(
      await within(canvas).findByRole('heading', { name: 'Venues in Bandung' }),
    ).toBeInTheDocument();
  });

  it('sends the venue the organizer chooses through the chat', async () => {
    const fetchMock = stubThread([scoutPart('s1', 'Jakarta', [loft, hall])]);
    render(<Workspace />);

    const canvas = await screen.findByRole('region', { name: 'Results' });
    expect(await within(canvas).findByText(/Pick a venue to continue/)).toBeInTheDocument();
    const choose = await within(canvas).findAllByRole('button', { name: 'Choose this venue' });
    fireEvent.click(choose[0]!);

    await vi.waitFor(() => {
      const sent = fetchMock.mock.calls.find(([url]) => url === '/api/chat');
      expect(String(sent?.[1]?.body)).toContain(
        'Venue chosen: Harbor Hall\\nSource: https://harbor.example/rooms',
      );
    });
  });

const summary = {
  event: {
    name: 'OpenHack 2027',
    date: '2027-03-14T09:00:00.000Z',
    headcount: 200,
    maxSpend: { amountMinor: 800_000, currency: 'USD' },
  },
  venue: {
    name: 'Harbor Hall',
    area: 'Central, Jakarta',
    includes: ['Stage', 'Sound system'],
    catering: 'no',
    sourceUrl: 'https://harbor.example/rooms',
  },
  estimate: {
    lines: [
      { label: '1 day', amountMinor: 16_000_000 },
      { label: 'Cleaning fee', amountMinor: 800_000 },
    ],
    total: 16_800_000,
    currency: 'IDR',
  },
  fx: { from: 'IDR', localMinorPerUsd: 16_000 },
  payable: { amountMinor: 105_000, currency: 'USD' },
  overMaxSpend: false,
};

const harborPick = {
  id: 'u2',
  role: 'user',
  parts: [{ type: 'text', text: 'Venue chosen: Harbor Hall\nSource: https://harbor.example/rooms' }],
};

// Serves the chat thread, and the booking summary and payment for it.
function stubBooking(
  pay: (() => Response) | null = null,
  body: unknown = summary,
  payment: unknown = { status: 'unpaid' },
) {
  const threadFetch = stubThread([scoutPart('s1', 'Jakarta', [loft, hall])], [harborPick]);
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    if (!url.startsWith('/api/venue-booking/')) return threadFetch(url, init);
    return Promise.resolve(
      init?.method === 'POST' && pay ? pay() : Response.json({ summary: body, payment }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

  it('shows the plan in place of the venue list once a venue is picked, and goes back to the list', async () => {
    stubBooking();
    render(<Workspace />);

    const panel = await screen.findByRole('region', { name: 'Plan summary' });
    expect(within(panel).getByRole('heading', { name: /OpenHack 2027 at Harbor Hall/ })).toBeInTheDocument();
    expect(within(panel).getByText('200')).toBeInTheDocument();
    expect(within(panel).getByText('Total to pay').nextSibling).toHaveTextContent('$1,050.00');
    expect(screen.queryByText('Chosen')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Back to venues' }));
    const canvas = screen.getByRole('region', { name: 'Results' });
    expect(await within(canvas).findByText('Chosen')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Plan summary' })).not.toBeInTheDocument();
    const chat = screen.getByRole('region', { name: 'Agent chat' });
    expect(within(chat).getByText(/Chosen: Harbor Hall/)).toBeInTheDocument();
  });

  it('pays the plan with PayPal only after the organizer agrees', async () => {
    const fetchMock = stubBooking(() =>
      Response.json({
        summary,
        outcome: { status: 'paid', orderId: 'ORD-1', captureId: 'CAP-1' },
      }),
    );
    render(<Workspace />);

    const panel = await screen.findByRole('region', { name: 'Plan summary' });
    const pay = within(panel).getByRole('button', { name: 'Agree and pay with PayPal' });
    expect(pay).toBeDisabled();
    fireEvent.click(within(panel).getByRole('checkbox'));
    expect(pay).toBeEnabled();
    fireEvent.click(pay);

    expect(await within(panel).findByText(/Paid with PayPal/)).toHaveTextContent('CAP-1');
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url.startsWith('/api/venue-booking/') && init?.method === 'POST',
    );
    expect(post?.[0]).toMatch(/^\/api\/venue-booking\/[0-9a-f-]{36}$/);
    // The browser sends no amount: the server works the total out itself.
    expect(post?.[1]?.body).toBeUndefined();
  });

  it('keeps showing a paid plan after a reload, and lets the organizer ask about it', async () => {
    const fetchMock = stubBooking(null, summary, { status: 'paid', reference: 'ORD-7' });
    render(<Workspace />);

    const panel = await screen.findByRole('region', { name: 'Plan summary' });
    expect(within(panel).getByText('Your plan · paid')).toBeInTheDocument();
    expect(await within(panel).findByText(/Paid with PayPal/)).toHaveTextContent('ORD-7');
    expect(within(panel).queryByRole('button', { name: 'Agree and pay with PayPal' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Back to venues' })).toBeNull();

    fireEvent.click(within(panel).getByRole('button', { name: 'Is catering covered?' }));
    await waitFor(() => {
      const chat = fetchMock.mock.calls.find(([url]) => url === '/api/chat');
      expect(String(chat?.[1]?.body)).toContain('Is catering covered?');
    });
  });

  it('warns when the total is over the max spend', async () => {
    stubBooking(null, { ...summary, overMaxSpend: true });
    render(<Workspace />);
    const panel = await screen.findByRole('region', { name: 'Plan summary' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/over your max spend/);
  });

  it('asks the treasurer to sign in before paying', async () => {
    stubBooking(() => Response.json({ error: 'treasurer only' }, { status: 401 }));
    render(<Workspace />);

    const panel = await screen.findByRole('region', { name: 'Plan summary' });
    fireEvent.click(within(panel).getByRole('checkbox'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Agree and pay with PayPal' }));
    expect(await within(panel).findByRole('link', { name: 'Log in with PayPal' })).toHaveAttribute(
      'href',
      '/api/auth/paypal/login',
    );
  });
});
