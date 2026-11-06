import { fireEvent, render, screen } from '@testing-library/react';
import type { ApprovalItem } from '@quartermaster/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { ApprovalDetail } from './ApprovalDetail';

afterEach(() => vi.unstubAllGlobals());

const payout: ApprovalItem = {
  id: 'ap-1',
  status: 'pending',
  createdAt: '2027-03-15T10:00:00Z',
  referenceId: 'prize-1',
  kind: 'payout',
  payee: 'Dana Lee',
  payeeEmail: 'dana@example.com',
  amountMinor: 50_000,
  currency: 'USD',
  actor: 'agent',
  agentReason: 'First prize, as announced on stage.',
  reasons: ['Payouts over $200 need your approval'],
};

function renderDetail(item: ApprovalItem, walletBlocked: string | null = null) {
  render(
    <ToastProvider>
      <ApprovalDetail
        item={item}
        clientId="client-id"
        walletBlocked={walletBlocked}
        onResolved={() => {}}
      />
    </ToastProvider>,
  );
}

describe('ApprovalDetail, payout', () => {
  it('shows where the money goes and asks before sending it, without a PayPal window', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'submitted', batchId: 'B1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetch);
    renderDetail(payout);

    expect(screen.getByRole('heading', { name: 'Dana Lee' })).toBeInTheDocument();
    expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    expect(document.querySelector('.paypal-mount')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve and pay $500.00' }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pay $500.00' }));

    expect(
      await screen.findByText(/PayPal accepted the payout to dana@example.com/),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/approvals/ap-1/capture',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cannot be sent without a PayPal email', () => {
    renderDetail({ ...payout, payeeEmail: undefined });
    expect(screen.getByText(/no PayPal email/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve and pay/ })).toBeDisabled();
  });

  it('is disabled with the reason when the kill switch is on', () => {
    renderDetail(payout, 'The agent can no longer spend.');
    expect(screen.getByText('The agent can no longer spend.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve and pay/ })).toBeDisabled();
  });
});
