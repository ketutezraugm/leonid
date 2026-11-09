import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countryName, Payouts } from './Payouts';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const item = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  eventId: 'e1',
  payoutId: null,
  kind: 'prize',
  recipientName: 'Ravi',
  destination: { recipientType: 'EMAIL', receiver: 'r***@winner.test', countryCode: 'IN' },
  amount: 50_000,
  currency: 'USD',
  category: 'prizes',
  sponsorId: null,
  claimId: null,
  note: '',
  senderItemId: 'payout:p1',
  paypalItemId: null,
  status: 'pending_approval',
  ruleResult: null,
  updatedAt: '2027-03-14T10:00:00.000Z',
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('Payouts tab', () => {
  it('names countries in full, in the form and in the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ payouts: [item()] }))));
    render(
      <MemoryRouter>
        <Payouts />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('cell', { name: 'India' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'India' })).toHaveValue('IN');
    expect(countryName('BR')).toBe('Brazil');
  });

  it('points to Approvals when a payout waits there', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void url;
      return Promise.resolve(init?.method === 'POST' ? json({ payouts: [item()] }, 201) : json({ payouts: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <Payouts />
      </MemoryRouter>,
    );
    await screen.findByText('No payouts yet.');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ravi' } });
    fireEvent.change(screen.getByLabelText('PayPal email'), { target: { value: 'ravi@winner.test' } });
    fireEvent.change(screen.getByLabelText('Country (optional)'), { target: { value: 'IN' } });
    fireEvent.change(screen.getByLabelText('Amount (US dollars)'), { target: { value: '500.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay through the rules' }));

    expect(await screen.findByRole('link', { name: 'Review it in Approvals' })).toHaveAttribute('href', expect.stringContaining('approvals'));
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST') as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ countryCode: 'IN', amount: 50_000, kind: 'prize' });
  });
});
