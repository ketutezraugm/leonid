import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { parseDollars } from '../checkout/api';

// The PayPal buttons are PayPal's own script; here they are a stand-in that records what each one would buy.
const bought: unknown[] = [];
vi.mock('../checkout/PayButtons', () => ({
  PayButtons: ({ request }: { request: unknown }) => {
    bought.push(request);
    return <div data-testid="pay-buttons" />;
  },
}));

const CONFIG = { eventName: 'OpenHack 2027', currency: 'USD', clientId: 'cid', ticketPriceMinor: 2500, donationMinMinor: 100, donationMaxMinor: 50000 };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function open(config: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/checkout/ev-1/config' ? json(config, status) : json({ error: 'no' }, 401))));
  render(
    <MemoryRouter initialEntries={['/e/ev-1']}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  bought.length = 0;
});

describe('parseDollars', () => {
  it('reads whole cents and nothing else', () => {
    expect(parseDollars('25')).toBe(2500);
    expect(parseDollars(' 12.5 ')).toBe(1250);
    expect(parseDollars('0.07')).toBe(7);
    for (const bad of ['', 'abc', '-5', '1.234', '1,5', '1e3', '$5']) expect(parseDollars(bad)).toBeNull();
  });
});

describe('public checkout page /e/:eventId', () => {
  it('shows the ticket price and a donation box without any login, and asks to buy exactly what is shown', async () => {
    open(CONFIG);
    expect(await screen.findByText('Ticket · $25.00')).toBeInTheDocument();
    expect(screen.getAllByTestId('pay-buttons')).toHaveLength(2);
    expect(bought).toEqual(expect.arrayContaining([{ kind: 'ticket' }, { kind: 'donation', amountMinor: 2500 }]));
  });

  it('takes no ticket orders for an event with no ticket price, and offers no button for an amount out of range', async () => {
    open({ ...CONFIG, ticketPriceMinor: null });
    await screen.findByText('Donate');
    expect(screen.queryByText(/Ticket ·/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '0.50' } });
    expect(await screen.findByText('Enter an amount from $1.00 to $500.00.')).toBeInTheDocument();
    expect(screen.queryByTestId('pay-buttons')).not.toBeInTheDocument();
  });

  it('says so when the event does not exist', async () => {
    open({ error: 'Event not found' }, 404);
    expect(await screen.findByText("We couldn't find this event")).toBeInTheDocument();
  });
});
