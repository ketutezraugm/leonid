import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

vi.mock('../chat/AgentChat', () => ({ AgentChat: () => null }));

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const hack = crypto.randomUUID();
const meetup = crypto.randomUUID();
const events = {
  events: [
    { id: hack, name: 'OpenHack 2027', date: '2027-03-14', people: 200, budget: 800_000, currency: 'USD' },
    { id: meetup, name: 'Spring Meetup', date: '2027-05-02', people: 60, budget: 120_000, currency: 'USD' },
  ],
};

function stubApi(me: unknown = { email: 'ada@example.com', via: 'paypal' }, treasury: () => Promise<Response> = () =>
  json({ merchantId: 'M1', asOf: null, balances: [{ currency: 'USD', totalMinor: 800_000, availableMinor: 800_000, withheldMinor: 0 }] })) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = String(url);
      if (path.startsWith('/api/events')) return json(events);
      if (path.startsWith('/api/auth/me')) return typeof me === 'object' && me ? json(me) : json({ error: 'x' }, 401);
      if (path.startsWith('/api/treasury')) return treasury();
      return new Promise(() => {});
    }),
  );
}

function open() {
  return render(
    <MemoryRouter initialEntries={[`/events/${hack}/claims`]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  stubApi();
});
afterEach(() => vi.unstubAllGlobals());

describe('AccountMenu', () => {
  it('shows the email and the PayPal balance, and hides and restores it', async () => {
    const view = open();
    expect(await screen.findByText('$8,000.00')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide balance' }));
    expect(screen.queryByText('$8,000.00')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show balance' })).toHaveAttribute('aria-pressed', 'true');
    view.unmount();
    open();
    expect(await screen.findByRole('button', { name: 'Show balance' })).toBeInTheDocument();
    expect(screen.queryByText('$8,000.00')).toBeNull();
  });

  it('opens a menu with Profile, Settings, the events and the footer links', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Account.*Open menu/ }));
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: /OpenHack 2027/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: /Spring Meetup/ })).toHaveAttribute('href', `/events/${meetup}/claims`);
    expect(screen.getByRole('link', { name: 'All events' })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/setup');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('closes on Escape and gives focus back to the card', async () => {
    open();
    const card = await screen.findByRole('button', { name: /Account.*Open menu/ });
    fireEvent.click(card);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(card).toHaveFocus();
  });

  it('names a demo session and still offers Sign out', async () => {
    stubApi({ via: 'demo' });
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Account, Demo organizer/ }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows a dash when the balance cannot load', async () => {
    stubApi(undefined, () => json({ error: 'down' }, 502));
    open();
    expect(await screen.findByText('—')).toBeInTheDocument();
  });
});
