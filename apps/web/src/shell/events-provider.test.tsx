import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsProvider, useEvents } from './event';

const summary = (name: string) => ({
  id: crypto.randomUUID(),
  name,
  date: '2999-05-02',
  endDate: '2999-05-02',
  people: 50,
  currency: 'USD',
  budget: 100_000,
  categories: [], city: null,
});

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

let api: ReturnType<typeof useEvents>;
function Probe() {
  const events = useEvents();
  useEffect(() => {
    api = events;
  });
  return <p>{`${events.kind}: ${events.events.map((e) => e.name).join(' | ')}`}</p>;
}
const mount = () =>
  render(
    <EventsProvider>
      <Probe />
    </EventsProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('EventsProvider', () => {
  it('puts the demo event first, then the events the person made', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ events: [summary('Spring Meetup')] })));
    mount();
    expect(await screen.findByText('ready: OpenHack 2027 | Spring Meetup')).toBeInTheDocument();
  });

  it('falls back to the demo event alone when the list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ error: 'no' }, 500)));
    mount();
    expect(await screen.findByText('fallback: OpenHack 2027')).toBeInTheDocument();
  });

  it('shows an event added after the list failed to load, and keeps it when the refresh fails too', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ error: 'no' }, 500)));
    mount();
    await screen.findByText('fallback: OpenHack 2027');
    act(() => api.add(summary('Fresh Meetup')));
    expect(await screen.findByText('ready: OpenHack 2027 | Fresh Meetup')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByText('ready: OpenHack 2027 | Fresh Meetup')).toBeInTheDocument();
  });

  it('keeps the list it has when a refresh fails, and lets a slow older response not drop a new event', async () => {
    const first = summary('Spring Meetup');
    const responses = [respond({ events: [first] }), respond({ error: 'down' }, 503)];
    vi.stubGlobal('fetch', vi.fn(() => responses.shift() ?? respond({ events: [first] })));
    mount();
    await screen.findByText('ready: OpenHack 2027 | Spring Meetup');
    act(() => api.refresh());
    await act(async () => {});
    expect(screen.getByText('ready: OpenHack 2027 | Spring Meetup')).toBeInTheDocument();

    // The server's list does not yet contain the event just added: it stays.
    const added = summary('Added Meetup');
    act(() => api.add(added));
    await waitFor(() => expect(screen.getByText(/Added Meetup/)).toBeInTheDocument());
    await act(async () => {});
    expect(screen.getByText(/Spring Meetup/)).toBeInTheDocument();
    expect(screen.getByText(/Added Meetup/)).toBeInTheDocument();
  });
});
