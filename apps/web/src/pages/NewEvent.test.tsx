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

// POST /api/events answers with `createStatus`; the rest answers enough for the agent page to open.
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
  sessionStorage.clear();
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

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pick = (name: string | RegExp) => fireEvent.click(screen.getByRole('radio', { name }));
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

// Kind, intro, then the eight questions with the hackathon defaults.
async function answerEverything() {
  renderSetup();
  fireEvent.click(await screen.findByRole('button', { name: /Workshop or hackathon/ }));
  click('Continue');
  click('I’m ready');
  type(/What’s the event called/, '  Spring Meetup ');
  click(/Confirm/);
  type(/Which day does it start/, '2027-05-20');
  click(/Confirm/);
  click('Skip'); // duration: keeps the full day
  pick(/Other/);
  type(/Number of people/, '80');
  click(/Confirm/);
  pick(/Jakarta/);
  click(/Confirm/);
  click(/Confirm/); // venue: find me one
  click(/Confirm/); // needs: the hackathon defaults
  pick(/Other/);
  type(/Budget in US dollars/, '1,500');
  click(/Confirm/);
}

describe('New event (setup interview)', () => {
  it('needs a kind before it starts', async () => {
    renderSetup();
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Something else/ }));
    expect(screen.getByLabelText(/What is it, in a few words/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('opens as a popup over All events and closes on Esc', async () => {
    renderSetup();
    expect(await screen.findByRole('dialog', { name: 'New event' })).toBeInTheDocument();
    // The list behind is there but hidden from assistive tech while the popup is open.
    expect(screen.queryByRole('heading', { name: 'Your events' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'Your events' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('will not move on without the required answers', async () => {
    renderSetup();
    fireEvent.click(await screen.findByRole('button', { name: /Meetup or small gathering/ }));
    click('Continue');
    click('I’m ready');
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    click(/Confirm/);
    expect(screen.getByRole('alert')).toHaveTextContent('Give the event a name.');
    expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
  });

  it('shows a summary before saving, and a changed answer comes back to it', async () => {
    await answerEverything();
    expect(screen.getByRole('heading', { name: 'Here’s your event' })).toBeInTheDocument();
    expect(screen.getByText('Spring Meetup')).toBeInTheDocument();
    expect(screen.getByText('$1,500')).toBeInTheDocument();
    expect(posted).toBeUndefined();

    click('Change: What’s the event called?');
    type(/What’s the event called/, 'Summer Meetup');
    click(/Confirm/);
    expect(screen.getByRole('heading', { name: 'Here’s your event' })).toBeInTheDocument();
    expect(screen.getByText('Summer Meetup')).toBeInTheDocument();
    expect(posted).toBeUndefined();
  });

  it('saves the event and every answer without starting the agent when the organizer skips', async () => {
    localStorage.setItem('quartermaster.threadId', 'an-earlier-chat');
    await answerEverything();
    click('Skip for now');
    expect(await screen.findByText(/Setting up Spring Meetup/)).toBeInTheDocument();
    expect(posted).toMatchObject({ name: 'Spring Meetup' });
    // The answers go with the event, so the agent chat can start planning with them later.
    const { brief } = posted as { brief: string };
    expect(brief).toContain('a hackathon for 80 people in Jakarta on Thursday, May 20, 2027');
    expect(brief).toContain('Book for this event: Venue, Food & drinks');
    await new Promise((r) => setTimeout(r, 700));
    expect(sessionStorage.getItem('quartermaster.kickoff')).toBeNull();
    // A fresh chat for the new event, not the one open before.
    expect(localStorage.getItem('quartermaster.threadId')).not.toBe('an-earlier-chat');
  });

  it('saves the event in cents, then opens the agent with the answers as its first message', async () => {
    await answerEverything();
    click('Start planning');
    expect(await screen.findByText(/Setting up Spring Meetup/)).toBeInTheDocument();
    expect(screen.getByText('Workshop or hackathon')).toBeInTheDocument();
    expect(posted).toMatchObject({
      name: 'Spring Meetup',
      date: '2027-05-20',
      people: 80,
      budget: 150_000,
      currency: 'USD',
    });

    expect(
      await screen.findByRole(
        'heading',
        { name: 'What the agent finds shows up here' },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    const kickoff = JSON.parse(sessionStorage.getItem('quartermaster.kickoff') ?? 'null');
    expect(kickoff).toMatchObject({ eventId: created.id, eventName: 'Spring Meetup' });
    expect(localStorage.getItem('quartermaster.threadId')).toBe(kickoff.threadId);
    expect(kickoff.text).toContain(
      'a hackathon for 80 people in Jakarta on Thursday, May 20, 2027',
    );
    expect(kickoff.text).toContain(
      'Book for this event: Venue, Food & drinks',
    );
  });

  it('says what went wrong and lets the organizer try again', async () => {
    stubApi(404);
    await answerEverything();
    click('Start planning');
    expect(await screen.findByRole('alert')).toHaveTextContent(/./);
    expect(screen.getByRole('button', { name: 'Change answers' })).toBeInTheDocument();
    expect(sessionStorage.getItem('quartermaster.kickoff')).toBeNull();
  });
});
