import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsProvider } from '../shell/event';
import { Plan } from './Plan';

// Bryntum Calendar needs a real browser layout; here it is a stub that says what it was given.
vi.mock('../home/BryntumPlanCalendar', () => ({
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

const plan = {
  eventDate: '2027-03-14T00:00:00.000Z',
  tasks: [
    {
      id: '0f1a5c2e-0000-4a6b-9c3d-000000000001',
      name: 'Registration desk',
      start: '2027-03-14T08:00:00.000Z',
      end: '2027-03-14T10:30:00.000Z',
      deadline: null,
      dependsOn: [],
      fundedBySponsorId: null,
      invoiceOfSponsorId: null,
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

function renderPlan() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = String(url).split('?')[0];
      const body =
        path === '/api/events/demo/plan'
          ? plan
          : path === '/api/sponsors'
            ? { sponsors: [] }
            : { error: 'no' };
      const ok = path === '/api/events/demo/plan' || path === '/api/sponsors';
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: ok ? 200 : 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return render(
    <MemoryRouter>
      <EventsProvider>
        <Plan />
      </EventsProvider>
    </MemoryRouter>,
  );
}

describe('Plan', () => {
  it('shows the event’s plan in the Bryntum calendar, with no Gantt', async () => {
    renderPlan();
    const calendar = await screen.findByRole('list', { name: 'calendar stub' });
    expect(calendar).toHaveAttribute('data-event-date', '2027-03-14T00:00:00.000Z');
    expect(screen.getByText('Registration desk 2027-03-14T08:00:00')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
