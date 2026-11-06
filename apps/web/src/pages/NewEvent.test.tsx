import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsProvider } from '../shell/event';
import { ToastProvider } from '../ui/Toast';
import { NewEvent } from './NewEvent';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const created = {
  id: crypto.randomUUID(),
  name: 'Test Meetup',
  date: '2999-05-01',
  endDate: '2999-05-03',
  people: 80,
  currency: 'USD',
  budgetTotalMinor: 250_050,
  categories: ['venue'],
  city: 'Jakarta',
};

function mount(post: (body: unknown) => Promise<Response>) {
  const fetchStub = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/events' && init?.method === 'POST') return post(JSON.parse(String(init.body)));
    if (url === '/api/events') return json({ events: [] });
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetchStub);
  render(
    <ToastProvider>
      <EventsProvider>
        <MemoryRouter initialEntries={['/setup']}>
          <Routes>
            <Route path="/setup" element={<NewEvent />} />
            <Route path="/events/:eventId/agent" element={<p>opened the agent</p>} />
          </Routes>
        </MemoryRouter>
      </EventsProvider>
    </ToastProvider>,
  );
  return fetchStub;
}

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => vi.unstubAllGlobals());

describe('New event', () => {
  it('says what to fix before anything is sent', async () => {
    const stub = mount(() => json(created, 201));
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('Enter a name for the event.')).toBeInTheDocument();
    expect(screen.getByText('Pick the first day.')).toBeInTheDocument();
    expect(stub.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getByLabelText('Event name')).toHaveFocus();
  });

  it('sends the shared request in integer cents, then opens the new event', async () => {
    let sent: unknown;
    mount((body) => {
      sent = body;
      return json({ event: created }, 201);
    });
    fill(/Event name/, 'Test Meetup');
    fill(/First day/, '2999-05-01');
    fill(/Last day/, '2999-05-03');
    fill(/People coming/, '80');
    fill(/Budget/, '$2,500.50');
    fill(/Spend categories/, 'Venue');
    fill(/City/, ' Jakarta ');
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('opened the agent')).toBeInTheDocument();
    expect(sent).toEqual({
      name: 'Test Meetup',
      date: '2999-05-01',
      endDate: '2999-05-03',
      people: 80,
      currency: 'USD',
      budgetTotalMinor: 250_050,
      categories: ['venue'],
      city: 'Jakarta',
    });
  });

  it('shows the server\'s refusal and lets the person try again', async () => {
    mount(() => json({ error: 'The event date is in the past' }, 422));
    fill(/Event name/, 'Test Meetup');
    fill(/First day/, '2999-05-01');
    fill(/Last day/, '2999-05-03');
    fill(/People coming/, '80');
    fill(/Budget/, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event date is in the past');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled());
  });
});
