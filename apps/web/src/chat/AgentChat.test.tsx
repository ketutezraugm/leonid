import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentChat } from './AgentChat';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const emptyThread = () => Response.json({ messages: [], checklist: [] });

// The AI SDK UI message stream: server-sent events of typed chunks, ended by [DONE].
function sse(chunks: object[]) {
  const body = [...chunks.map((c) => JSON.stringify(c)), '[DONE]']
    .map((d) => `data: ${d}\n\n`)
    .join('');
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

const text = (delta: string) => [
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta },
  { type: 'text-end', id: 't1' },
];

type Summary = { id: string; title: string; updatedAt: string };

function stubFetch({
  thread = emptyThread,
  reply,
  threads = [],
  demoEvent = null,
}: {
  thread?: (id: string) => Response;
  reply?: () => Response;
  threads?: Summary[];
  demoEvent?: { id: string; name: string } | null;
}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/chat/threads/lookup') {
      return Promise.resolve(Response.json({ threads, demoEvent }));
    }
    if (init?.method === 'PATCH' || init?.method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (init?.method === 'POST') return Promise.resolve(reply?.() ?? sse([]));
    return Promise.resolve(thread(url.split('/').pop() ?? ''));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const summary = (id: string, title: string): Summary => ({
  id,
  title,
  updatedAt: new Date().toISOString(),
});

function type(message: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('AgentChat', () => {
  it('sends only the new message with the thread id and shows the streamed reply', async () => {
    const fetchMock = stubFetch({
      reply: () => sse([{ type: 'start' }, ...text('$3,200 is unlocked.'), { type: 'finish' }]),
    });
    render(<AgentChat />);

    await screen.findByLabelText('Message');
    type('How much is unlocked?');

    expect(await screen.findByText('$3,200 is unlocked.')).toBeInTheDocument();
    expect(screen.getByText('How much is unlocked?')).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/chat' && init?.method === 'POST',
    );
    const sent = JSON.parse(String(post?.[1]?.body));
    expect(sent.threadId).toBe(localStorage.getItem('quartermaster.threadId'));
    expect(sent.message).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'How much is unlocked?' }],
    });
    expect(sent.messages).toBeUndefined();
  });

  it('sends the setup answers once, linked to the new event, when the chat opens', async () => {
    const fetchMock = stubFetch({
      reply: () => sse([{ type: 'start' }, ...text('On it.'), { type: 'finish' }]),
    });
    const threadId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    localStorage.setItem('quartermaster.threadId', threadId);
    sessionStorage.setItem(
      'quartermaster.kickoff',
      JSON.stringify({
        threadId,
        eventId,
        eventName: 'Spring Meetup',
        text: 'Plan our new event.',
      }),
    );
    // StrictMode, as in the app: its trial unmount stops the chat, and the answers must still go.
    render(
      <StrictMode>
        <AgentChat />
      </StrictMode>,
    );

    expect(await screen.findByText('On it.')).toBeInTheDocument();
    expect(screen.getByText('Event: Spring Meetup')).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/chat' && init?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({
      threadId,
      eventId,
      message: { parts: [{ type: 'text', text: 'Plan our new event.' }] },
    });
    expect(sessionStorage.getItem('quartermaster.kickoff')).toBeNull();
  });

  it('links a new chat to the event it is opened in', async () => {
    const eventId = crypto.randomUUID();
    const fetchMock = stubFetch({ reply: () => sse([{ type: 'start' }]) });
    render(<AgentChat inEvent={{ id: eventId, name: 'Spring Meetup' }} />);

    expect(await screen.findByText('Ask me anything about Spring Meetup.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan a hackathon/ })).not.toBeInTheDocument();
    type('Check my event');

    await screen.findByText('Event: Spring Meetup');
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/chat' && init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body)).eventId).toBe(eventId);
  });

  it('uses the seeded event inside the demo event', async () => {
    const demo = { id: crypto.randomUUID(), name: 'OpenHack 2027' };
    const fetchMock = stubFetch({ demoEvent: demo, reply: () => sse([{ type: 'start' }]) });
    render(<AgentChat inEvent={{ id: null, name: 'OpenHack 2027' }} />);

    await screen.findByText('Ask me anything about OpenHack 2027.');
    type('Check my event');

    await screen.findByText('Event: OpenHack 2027');
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/chat' && init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body)).eventId).toBe(demo.id);
  });

  it('sends no event outside an event', async () => {
    const demo = { id: crypto.randomUUID(), name: 'OpenHack 2027' };
    const fetchMock = stubFetch({ demoEvent: demo, reply: () => sse([{ type: 'start' }]) });
    render(<AgentChat />);

    await screen.findByText('Tell me about your event.');
    type('Plan a new event');

    await screen.findByText('No event in this chat yet');
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/chat' && init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty('eventId');
  });

  it('shows the checklist the agent writes and a step line for delegation', async () => {
    const items = [
      { title: 'Plan swag', status: 'in_progress' },
      { title: 'Pay vendor', status: 'blocked', blockedOn: 'Sponsor invoice' },
    ];
    stubFetch({
      reply: () =>
        sse([
          { type: 'start' },
          {
            type: 'tool-input-available',
            toolCallId: 'c1',
            toolName: 'update_checklist',
            input: { items },
          },
          {
            type: 'tool-output-available',
            toolCallId: 'c1',
            output: { items, mandateStatus: 'waiting' },
          },
          {
            type: 'tool-input-available',
            toolCallId: 'c2',
            toolName: 'delegate_to_planning',
            input: { task: 'x' },
          },
          { type: 'tool-output-available', toolCallId: 'c2', output: { summary: 'ok' } },
          ...text('Swag is planned.'),
          { type: 'finish' },
        ]),
    });
    render(<AgentChat />);

    await screen.findByLabelText('Message');
    type('Plan swag');

    expect(await screen.findByText('Swag is planned.')).toBeInTheDocument();
    const checklist = screen.getByRole('complementary', { name: 'Agent checklist' });
    expect(checklist).toHaveTextContent('Plan swag');
    expect(checklist).toHaveTextContent('Pay vendor');
    expect(checklist).toHaveTextContent('waiting on Sponsor invoice');
    expect(screen.getByText('Planning agent')).toBeInTheDocument();
  });

  it('shows the agent questions as choices and sends the answers as one message', async () => {
    const questions = [
      {
        header: 'Date',
        question: 'Which Saturday?',
        options: [{ label: '7 Nov 2026', description: 'Next week' }, { label: '14 Nov 2026' }],
      },
      {
        header: 'Format',
        question: 'What should it include?',
        options: [{ label: 'Talks' }, { label: 'Workshop' }],
        multiSelect: true,
      },
    ];
    const fetchMock = stubFetch({
      reply: () =>
        sse([
          { type: 'start' },
          {
            type: 'tool-input-available',
            toolCallId: 'q1',
            toolName: 'ask_user',
            input: { questions },
          },
          { type: 'tool-output-available', toolCallId: 'q1', output: { asked: 2 } },
          { type: 'finish' },
        ]),
    });
    render(<AgentChat />);

    await screen.findByLabelText('Message');
    type('Plan a meetup');

    const card = await screen.findByRole('form', { name: 'Questions from Leo' });
    const submit = within(card).getByRole('button', { name: 'Send answers' });
    expect(submit).toBeDisabled();

    fireEvent.click(within(card).getByRole('button', { name: /7 Nov 2026/ }));
    fireEvent.click(within(card).getByRole('button', { name: 'Talks' }));
    const others = within(card).getAllByRole('button', { name: /Other/ });
    fireEvent.click(others[1]!);
    fireEvent.change(within(card).getByLabelText('Your answer: Format'), {
      target: { value: 'Networking' },
    });
    fireEvent.click(submit);

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([url]) => url === '/api/chat');
      expect(posts).toHaveLength(2);
      const body = JSON.parse(String(posts[1]?.[1]?.body));
      expect(body.message.parts[0].text).toBe('Date: 7 Nov 2026\nFormat: Talks, Networking');
    });
  });

  it('offers only the venue to book and shows the rest as in development', async () => {
    const fetchMock = stubFetch({
      reply: () =>
        sse([
          { type: 'start' },
          {
            type: 'tool-input-available',
            toolCallId: 'b1',
            toolName: 'choose_bookings',
            input: { suggested: ['venue', 'catering'] },
          },
          { type: 'tool-output-available', toolCallId: 'b1', output: { shown: 8 } },
          { type: 'finish' },
        ]),
    });
    render(<AgentChat />);

    await screen.findByLabelText('Message');
    type('Plan a meetup');

    const card = await screen.findByRole('form', { name: 'What to book' });
    expect(within(card).getByRole('checkbox', { name: /Venue/ })).toBeChecked();
    // Suggested by the agent, but still in development: shown, not choosable.
    const food = within(card).getByRole('checkbox', { name: /Food & drinks/ });
    expect(food).toBeDisabled();
    expect(food).not.toBeChecked();
    expect(within(card).getByRole('checkbox', { name: /Swag/ })).toBeDisabled();
    expect(within(card).getAllByText('In development')).toHaveLength(7);

    fireEvent.click(within(card).getByRole('button', { name: 'Plan 1 item' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([url]) => url === '/api/chat');
      expect(posts).toHaveLength(2);
      const body = JSON.parse(String(posts[1]?.[1]?.body));
      expect(body.message.parts[0].text).toBe('Book for this event: Venue');
    });
  });

  it('holds View results in the drawer until the run ends, since leaving would stop it', async () => {
    let finish: (reply: Response) => void = () => {};
    const fetchMock = stubFetch({
      thread: () =>
        Response.json({
          messages: [
            {
              id: 'a1',
              role: 'assistant',
              parts: [
                {
                  type: 'tool-delegate_to_venue_scout',
                  toolCallId: 's1',
                  state: 'output-available',
                  input: { city: 'Singapore', headcount: 80 },
                  output: { activity: [], candidates: [], summary: 'None.' },
                },
              ],
            },
          ],
          checklist: [],
        }),
    });
    const passThrough = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) =>
      url === '/api/chat' && init?.method === 'POST'
        ? new Promise((resolve) => (finish = resolve))
        : passThrough(url, init),
    );
    const onViewSearch = vi.fn();
    render(<AgentChat onViewSearch={onViewSearch} viewLeavesChat />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results' }));
    expect(onViewSearch).toHaveBeenCalledWith('s1');

    type('Anything else?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Working…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View results' })).not.toBeInTheDocument();

    finish(sse(text('Done.')));
    expect(await screen.findByRole('button', { name: 'View results' })).toBeInTheDocument();
  });

  it('starts with the agent checklist closed and opens it on click', async () => {
    stubFetch({
      thread: () =>
        Response.json({
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Plan it' }] }],
          checklist: [
            { title: 'Create the event', status: 'done' },
            { title: 'Plan swag', status: 'in_progress' },
          ],
        }),
    });
    render(<AgentChat />);

    const toggle = await screen.findByRole('button', { name: /Checklist/ });
    const list = within(screen.getByRole('complementary', { name: 'Agent checklist' })).getByRole(
      'list',
      { hidden: true },
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(list).not.toBeVisible();
    expect(toggle).toHaveTextContent('1/2 done · Plan swag');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(list).toBeVisible();

    fireEvent.click(toggle);
    expect(list).not.toBeVisible();
  });

  it('restores the earlier conversation and checklist on load', async () => {
    stubFetch({
      thread: () =>
        Response.json({
          messages: [
            { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Plan swag' }] },
            { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Swag is planned.' }] },
          ],
          checklist: [{ title: 'Plan swag', status: 'done' }],
        }),
    });
    render(<AgentChat />);

    expect(await screen.findByText('Swag is planned.')).toBeInTheDocument();
    expect(screen.getByText('Plan swag', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Agent checklist' })).toHaveTextContent(
      'Plan swag',
    );
  });

  it('restores the draft and shows the server error when the request fails', async () => {
    stubFetch({
      reply: () =>
        Response.json({ error: 'The agent is not configured on this server.' }, { status: 503 }),
    });
    render(<AgentChat />);

    await screen.findByLabelText('Message');
    type('Find a venue in Jakarta for 30 people');

    expect(await screen.findByRole('alert')).toHaveTextContent('not configured');
    // The draft comes back in an effect after the alert renders.
    await waitFor(() =>
      expect(screen.getByLabelText('Message')).toHaveValue('Find a venue in Jakarta for 30 people'),
    );
    expect(
      screen.queryByText('Find a venue in Jakarta for 30 people', { selector: 'div' }),
    ).not.toBeInTheDocument();
  });

  it('lists earlier chats and loads the one you pick', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    localStorage.setItem('quartermaster.threadId', a);
    localStorage.setItem('quartermaster.threadIds', JSON.stringify([a, b]));
    stubFetch({
      threads: [summary(a, 'Plan swag'), summary(b, 'Budget check')],
      thread: (id) =>
        id === b
          ? Response.json({
              messages: [
                { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Budget answer.' }] },
              ],
              checklist: [],
            })
          : emptyThread(),
    });
    render(<AgentChat />);

    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    expect(await within(nav).findByText('Budget check')).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^Plan swag/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    fireEvent.click(within(nav).getByRole('button', { name: /^Budget check/ }));

    expect(await screen.findByText('Budget answer.')).toBeInTheDocument();
    expect(localStorage.getItem('quartermaster.threadId')).toBe(b);
  });

  it('starts a fresh thread on New chat once the current one has messages', async () => {
    const a = crypto.randomUUID();
    localStorage.setItem('quartermaster.threadId', a);
    stubFetch({ threads: [summary(a, 'Plan swag')] });
    render(<AgentChat />);
    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    await within(nav).findByText('Plan swag');

    fireEvent.click(within(nav).getByRole('button', { name: 'New chat' }));
    await screen.findByLabelText('Message');

    expect(localStorage.getItem('quartermaster.threadId')).not.toBe(a);
  });

  it('reuses an empty current chat instead of creating another', async () => {
    stubFetch({});
    render(<AgentChat />);
    await screen.findByLabelText('Message');
    const before = localStorage.getItem('quartermaster.threadId');
    const nav = screen.getByRole('navigation', { name: 'Chats' });
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: 'New chat' })).toBeEnabled(),
    );

    fireEvent.click(within(nav).getByRole('button', { name: 'New chat' }));

    expect(localStorage.getItem('quartermaster.threadId')).toBe(before);
  });

  it('archives the active chat, falls back to another and offers undo', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    localStorage.setItem('quartermaster.threadId', a);
    localStorage.setItem('quartermaster.threadIds', JSON.stringify([a, b]));
    const fetchMock = stubFetch({ threads: [summary(a, 'Plan swag'), summary(b, 'Budget check')] });
    render(<AgentChat />);
    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    await within(nav).findByText('Budget check');

    fireEvent.click(within(nav).getByRole('button', { name: 'Archive Plan swag' }));

    await waitFor(() => expect(localStorage.getItem('quartermaster.threadId')).toBe(b));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toBe(`/api/chat/${a}`);
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ archived: true });
    expect(await screen.findByRole('status')).toHaveTextContent('Archived “Plan swag”');
  });

  it('deletes the active chat after confirming and drops it from this browser', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    localStorage.setItem('quartermaster.threadId', a);
    localStorage.setItem('quartermaster.threadIds', JSON.stringify([a, b]));
    const fetchMock = stubFetch({ threads: [summary(a, 'Plan swag'), summary(b, 'Budget check')] });
    render(<AgentChat />);
    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    await within(nav).findByText('Budget check');

    fireEvent.click(within(nav).getByRole('button', { name: 'Delete Plan swag' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(within(nav).getByRole('button', { name: 'Confirm delete Plan swag' }));

    await waitFor(() => expect(localStorage.getItem('quartermaster.threadId')).toBe(b));
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(del?.[0]).toBe(`/api/chat/${a}`);
    expect(JSON.parse(localStorage.getItem('quartermaster.threadIds') ?? '[]')).toEqual([b]);
  });

  it('keeps the chat when delete is cancelled', async () => {
    const a = crypto.randomUUID();
    localStorage.setItem('quartermaster.threadId', a);
    const fetchMock = stubFetch({ threads: [summary(a, 'Plan swag')] });
    render(<AgentChat />);
    const nav = await screen.findByRole('navigation', { name: 'Chats' });
    await within(nav).findByText('Plan swag');

    fireEvent.click(within(nav).getByRole('button', { name: 'Delete Plan swag' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Cancel' }));

    expect(within(nav).getByRole('button', { name: 'Delete Plan swag' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});
