import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

vi.mock('../chat/AgentChat', () => ({ AgentChat: () => null }));

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

const created = {
  id: '7b2f3c1e-1f0a-4c55-9a51-2a8f0b6d8e10',
  name: 'Spring Meetup',
  date: '2027-05-20',
  people: 80,
  budget: 150_000,
  currency: 'USD',
};
let posted: unknown;

// POST /api/events answers with `createStatus`; the rest answers enough for the three steps.
function stubApi(createStatus = 201, wallet = 'none') {
  posted = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/events' && init?.method === 'POST') {
        posted = JSON.parse(String(init.body));
        return createStatus === 201 ? json(created, 201) : json({ error: 'x' }, createStatus);
      }
      if (path.startsWith('/api/events')) return json({ events: posted ? [created] : [] });
      if (path.startsWith('/api/treasury'))
        return json({
          merchantId: null,
          asOf: null,
          balances: [{ currency: 'USD', totalMinor: 0, availableMinor: 0, withheldMinor: 0 }],
        });
      if (path.startsWith('/api/wallet')) return json({ status: wallet });
      return new Promise(() => {});
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  stubApi();
});
afterEach(() => vi.unstubAllGlobals());

function renderSetup() {
  render(
    <MemoryRouter initialEntries={['/setup']}>
      <App />
    </MemoryRouter>,
  );
}

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('New event (setup)', () => {
  it('checks every field before saving anything', async () => {
    renderSetup();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Give the event a name.')).toBeInTheDocument();
    expect(screen.getByText('Pick the event day.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Budget/)).toHaveAttribute('aria-invalid', 'true');
    expect(posted).toBeUndefined();
  });

  it('saves the event in cents, confirms the treasury, then offers the shared wallet', async () => {
    renderSetup();
    fill(/Event name/, '  Spring Meetup ');
    fill(/Event day/, '2027-05-20');
    fill(/People coming/, '80');
    fill(/Budget/, '1,500');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Treasury connected/)).toBeInTheDocument();
    expect(posted).toEqual({
      name: 'Spring Meetup',
      date: '2027-05-20',
      people: 80,
      budget: 150_000,
      currency: 'USD',
    });
    expect(screen.getByText(/\$1,500\.00 budget, 80 people/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText("The agent can't buy anything until you connect a wallet."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: 'Event home' })).toBeInTheDocument();
  });

  it('says so when the server cannot create events yet', async () => {
    stubApi(404);
    renderSetup();
    fill(/Event name/, 'Spring Meetup');
    fill(/Event day/, '2027-05-20');
    fill(/People coming/, '80');
    fill(/Budget/, '1500');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'isn’t available on this server yet',
    );
  });
});
