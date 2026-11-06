import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

vi.mock('../chat/AgentChat', () => ({ AgentChat: () => <p>chat stub</p> }));
// Bryntum is large and draws the demo plan only; if an own event ever loaded it, this would show.
vi.mock('../plan/PlanGantt', () => ({ default: () => <p>DEMO GANTT</p> }));
vi.mock('../money/CommandCenter', () => ({ default: () => <p>DEMO COMMAND CENTER</p> }));

const id = crypto.randomUUID();
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function stubApi(overview: unknown, overviewStatus = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/events') {
        return json({
          events: [{ id, name: 'Spring Meetup', date: '2999-05-02', endDate: '2999-05-02', people: 60, currency: 'USD', budget: 300_000, categories: [] }],
        });
      }
      if (url === `/api/events/${id}/overview`) return json(overview, overviewStatus);
      if (url.startsWith('/api/approvals')) return json({ approvals: [] });
      return new Promise(() => {});
    }),
  );
}

const open = (screen: string) =>
  render(
    <MemoryRouter initialEntries={[`/events/${id}/${screen}`]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('screens of an event the person made', () => {
  it('Event home shows the real unlocked figure, and says why nothing is unlocked yet', async () => {
    stubApi({ unlockedMinor: 0, tasks: [] });
    open('');
    expect(await screen.findByText('Nothing is unlocked yet', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask the agent to plan it' })).toBeInTheDocument();
  });

  it('Event home never shows a failed load as $0', async () => {
    stubApi({ error: 'down' }, 500);
    open('');
    expect(await screen.findByText(/isn’t shown until it loads/)).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('Plan lists this event\'s tasks, not the demo Gantt', async () => {
    stubApi({
      unlockedMinor: 0,
      tasks: [{ id: crypto.randomUUID(), name: 'Book the venue', start: '2999-03-01', end: '2999-03-05', deadline: null }],
    });
    open('plan');
    expect(await screen.findByRole('rowheader', { name: 'Book the venue' })).toBeInTheDocument();
    expect(screen.queryByText('DEMO GANTT')).not.toBeInTheDocument();
  });

  it('Plan points to the agent when there are no tasks', async () => {
    stubApi({ unlockedMinor: 0, tasks: [] });
    open('plan');
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument();
  });

  it('Money shows an empty state, not the demo\'s sample widgets', async () => {
    stubApi({ unlockedMinor: 0, tasks: [] });
    open('money');
    expect(await screen.findByText('No money yet')).toBeInTheDocument();
    expect(screen.queryByText('DEMO COMMAND CENTER')).not.toBeInTheDocument();
  });
});

describe('the demo event keeps its screens', () => {
  it('Plan and Money still open the demo Gantt and command center', async () => {
    stubApi({ unlockedMinor: 0, tasks: [] });
    const plan = render(
      <MemoryRouter initialEntries={['/events/demo/plan']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('DEMO GANTT')).toBeInTheDocument();
    plan.unmount();
    render(
      <MemoryRouter initialEntries={['/events/demo/money']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('DEMO COMMAND CENTER')).toBeInTheDocument();
  });
});
