import { fireEvent, render, screen, within } from '@testing-library/react';
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
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
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

  it('marks the chosen venue once the organizer has picked it', async () => {
    stubThread(
      [scoutPart('s1', 'Jakarta', [loft, hall])],
      [
        {
          id: 'u2',
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Venue chosen: Harbor Hall\nSource: https://harbor.example/rooms',
            },
          ],
        },
      ],
    );
    render(<Workspace />);

    const canvas = await screen.findByRole('region', { name: 'Results' });
    expect(await within(canvas).findByText('Chosen')).toBeInTheDocument();
    expect(within(canvas).queryByText(/Pick a venue to continue/)).not.toBeInTheDocument();
    const chat = screen.getByRole('region', { name: 'Agent chat' });
    expect(within(chat).getByText(/Chosen: Harbor Hall/)).toBeInTheDocument();
  });
});
