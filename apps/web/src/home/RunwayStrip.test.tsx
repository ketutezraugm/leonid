import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsProvider } from '../shell/event';
import { RunwayStrip } from './RunwayStrip';

// Bryntum Calendar needs a real browser layout; here it is a stub that lists what it was given.
vi.mock('./BryntumPlanCalendar', () => ({
  default: ({
    events,
    eventDate,
  }: {
    events: { name: string; startDate: string }[];
    eventDate: string;
  }) => (
    <ul aria-label="calendar stub" data-event-date={eventDate}>
      {events.map((e) => (
        <li key={e.name}>
          {e.name} {e.startDate}
        </li>
      ))}
    </ul>
  ),
}));

const task = (n: number, name: string, start: string, end: string) => ({
  id: `0f1a5c2e-0000-4a6b-9c3d-00000000000${n}`,
  name,
  start,
  end,
  deadline: null,
  dependsOn: [],
  fundedBySponsorId: null,
  invoiceOfSponsorId: null,
  kind: 'task',
  workstream: null,
});

afterEach(() => vi.unstubAllGlobals());

function renderStrip(plan: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const ok = String(url).startsWith('/api/events/demo/plan');
      return Promise.resolve(
        new Response(JSON.stringify(ok ? plan : { error: 'no' }), {
          status: ok ? 200 : 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return render(
    <MemoryRouter>
      <EventsProvider>
        <RunwayStrip />
      </EventsProvider>
    </MemoryRouter>,
  );
}

describe('RunwayStrip', () => {
  it('gives Bryntum Calendar the event’s own tasks, as wall-clock times', async () => {
    renderStrip({
      eventDate: '2027-03-14T00:00:00.000Z',
      tasks: [task(1, 'Registration desk', '2027-03-14T08:00:00.000Z', '2027-03-14T10:30:00.000Z')],
    });
    const calendar = await screen.findByRole('list', { name: 'calendar stub' });
    expect(calendar).toHaveAttribute('data-event-date', '2027-03-14T00:00:00.000Z');
    expect(screen.getByText('Registration desk 2027-03-14T08:00:00')).toBeInTheDocument();
    expect(screen.getByText(/Next: Registration desk/)).toBeInTheDocument();
  });

  it('shows no calendar, and says so, when the event has no plan yet', async () => {
    renderStrip({ eventDate: '2027-03-14T00:00:00.000Z', tasks: [] });
    expect(await screen.findByText(/No plan yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'calendar stub' })).not.toBeInTheDocument();
  });
});
