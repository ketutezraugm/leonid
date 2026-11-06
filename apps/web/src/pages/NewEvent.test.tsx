import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  date: '2999-05-20',
  endDate: '2999-05-21',
  people: 80,
  currency: 'USD',
  budget: 150_050,
  categories: ['venue'],
  city: 'Jakarta',
};
let posted: unknown;

// POST /api/events answers `create`; the rest answers enough for the three steps.
function stubApi(create: () => Promise<Response> = () => json({ event: created }, 201), wallet = 'none') {
  posted = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/events' && init?.method === 'POST') {
        posted = JSON.parse(String(init.body));
        return create();
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

function fillRequired() {
  fill(/Event name/, '  Spring Meetup ');
  fill(/First day/, '2999-05-20');
  fill(/Last day/, '2999-05-21');
  fill(/People coming/, '80');
  fill(/Budget/, '$1,500.50');
}

describe('New event (setup)', () => {
  it('checks every field before saving anything', async () => {
    renderSetup();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter a name for the event.')).toBeInTheDocument();
    expect(screen.getByText('Pick the first day.')).toBeInTheDocument();
    expect(screen.getByLabelText('Event name')).toHaveFocus();
    expect(posted).toBeUndefined();
  });

  it('saves the event in cents, confirms the treasury, offers the shared wallet, then opens the agent', async () => {
    renderSetup();
    fillRequired();
    fill(/Spend categories/, 'Venue');
    fill(/City/, ' Jakarta ');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Treasury connected/)).toBeInTheDocument();
    expect(posted).toEqual({
      name: 'Spring Meetup',
      date: '2999-05-20',
      endDate: '2999-05-21',
      people: 80,
      currency: 'USD',
      budget: 150_050,
      categories: ['venue'],
      city: 'Jakarta',
    });
    expect(screen.getByText(/\$1,500\.50 budget, 80 people/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText("The agent can't buy anything until you connect a wallet."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('region', { name: 'Results' })).toBeInTheDocument();
  });

  it("shows the server's refusal and lets the person try again", async () => {
    stubApi(() => json({ error: 'The event date is in the past' }, 422));
    renderSetup();
    fillRequired();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event date is in the past');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
  });
});
