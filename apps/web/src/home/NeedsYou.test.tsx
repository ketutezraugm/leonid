import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalItem } from '@quartermaster/shared';
import { NeedsYou } from './NeedsYou';

const item = (id: string, createdAt: string): ApprovalItem => ({
  id,
  status: 'pending',
  createdAt,
  referenceId: `cart-${id}`,
  amountMinor: 42_000,
  currency: 'USD',
  actor: 'procurement agent',
  agentReason: 'Prizes for three winners',
  reasons: ['Over the $200.00 per-order rule'],
  vendor: 'Prize cart',
});

function renderNeeds(props: Parameters<typeof NeedsYou>[0]) {
  return render(
    <MemoryRouter>
      <NeedsYou {...props} />
    </MemoryRouter>,
  );
}

describe('NeedsYou', () => {
  it('never says nothing is waiting when approvals failed to load', () => {
    const onRetry = vi.fn();
    renderNeeds({ state: 'error', waiting: [], onRetry });
    expect(screen.queryByText(/Nothing is waiting/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Couldn’t load approvals' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not claim an empty queue while still loading', () => {
    renderNeeds({ state: 'loading', waiting: [], onRetry: () => {} });
    expect(screen.queryByText(/Nothing is waiting/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking approvals…');
  });

  it('is one quiet line when the queue is really empty', () => {
    renderNeeds({ state: 'ready', waiting: [], onRetry: () => {} });
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument();
  });

  it('leads with the oldest item, its amount and the rule that sent it, and counts the rest', () => {
    renderNeeds({ state: 'ready', waiting: [item('a', '2027-01-01T00:00:00Z'), item('b', '2027-01-02T00:00:00Z')], onRetry: () => {} });
    expect(screen.getByRole('heading', { name: /Needs you 2/ })).toBeInTheDocument();
    expect(screen.getByText('$420.00')).toBeInTheDocument();
    expect(screen.getByText('Over the $200.00 per-order rule')).toBeInTheDocument();
    expect(screen.getByText('and 1 more waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review in Approvals' })).toHaveAttribute('href', '/approvals');
  });
});
