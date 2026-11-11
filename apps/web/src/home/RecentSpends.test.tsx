import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsProvider } from '../shell/event';
import { RecentSpends } from './RecentSpends';

const spend = (n: number) => ({
  id: `spend-${n}`,
  at: '2027-01-26T12:00:00.000Z',
  actor: 'agent',
  amountMinor: 1_000 * n,
  currency: 'USD',
  category: null,
  vendor: `Vendor ${n}`,
  agentReason: null,
  decision: 'allow',
  reasons: [],
  status: 'paid',
  paypalId: null,
  eventId: null,
});

function stub(count: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(url).startsWith('/api/spends/recent')
              ? { spends: Array.from({ length: count }, (_, i) => spend(i + 1)) }
              : { error: 'not found' },
          ),
          {
            status: String(url).startsWith('/api/spends/recent') ? 200 : 404,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    ),
  );
}

const renderSpends = () =>
  render(
    <MemoryRouter>
      <EventsProvider>
        <RecentSpends />
      </EventsProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('RecentSpends paging', () => {
  it('shows five spends at a time and pages through the rest', async () => {
    stub(12);
    renderSpends();
    expect(await screen.findByText('Vendor 1')).toBeInTheDocument();
    expect(screen.getByText('Vendor 5')).toBeInTheDocument();
    expect(screen.queryByText('Vendor 6')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Vendor 6')).toBeInTheDocument();
    expect(screen.queryByText('Vendor 5')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Vendor 12')).toBeInTheDocument();
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('keeps the card the same height when fewer than five spends fill the page', async () => {
    stub(3);
    renderSpends();
    expect(await screen.findByText('Vendor 3')).toBeInTheDocument();
    // Three real rows plus two blank ones, and the pager stays with both buttons off.
    expect(document.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(document.querySelectorAll('tr.ledger-blank')).toHaveLength(2);
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
