import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// The drawer's chat is P1's and has its own tests; here it is a stub so we test only the shell.
vi.mock('./chat/AgentChat', () => ({
  AgentChat: ({ onViewSearch }: { onViewSearch?: (id: string) => void }) => (
    <button type="button" onClick={() => onViewSearch?.('search-1')}>
      chat stub
    </button>
  ),
}));

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

// /api/events answers (by default a 404, so the app falls back to the demo event); every other request never
// settles, so these tests check the shell and first render only.
function stubApi(events?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      String(url).startsWith('/api/events')
        ? events
          ? json(events)
          : json({ error: 'not found' }, 404)
        : new Promise(() => {}),
    ),
  );
}

beforeEach(() => {
  localStorage.clear();
  stubApi();
});
afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('renders the shell and event home inside an event', async () => {
    render(
      <MemoryRouter initialEntries={['/events/demo']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Event home' })).toBeInTheDocument();
    expect(screen.getByText('Quartermaster')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('opens on All events, with the demo event as a card when the events endpoint is missing', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Your events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /OpenHack 2027/ })).toHaveAttribute('href', '/events/demo');
    expect(screen.getByText(/Showing the demo event/)).toBeInTheDocument();
  });

  it('switches events from the sidebar and stays on the same screen', async () => {
    const hack = crypto.randomUUID();
    const meetup = crypto.randomUUID();
    stubApi({
      events: [
        { id: hack, name: 'OpenHack 2027', date: '2027-03-14', people: 200, budget: 800_000, currency: 'USD' },
        { id: meetup, name: 'Spring Meetup', date: '2027-05-02', people: 60, budget: 120_000, currency: 'USD' },
      ],
    });
    render(
      <MemoryRouter initialEntries={[`/events/${hack}/approvals`]}>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /OpenHack 2027.*Switch event/ }));
    const other = screen.getByRole('link', { name: /Spring Meetup/ });
    expect(other).toHaveAttribute('href', `/events/${meetup}/approvals`);
    expect(screen.getByRole('link', { name: /OpenHack 2027/ })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(other);
    expect(await screen.findByRole('button', { name: /Spring Meetup.*Switch event/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
  });

  it('says so when the event in the link is not one of yours', async () => {
    render(
      <MemoryRouter initialEntries={['/events/not-mine']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('This event isn’t here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all your events' })).toHaveAttribute('href', '/events');
  });

  it('offers a skip link that jumps past the sidebar to the screen', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(document.getElementById('main')).toBeInTheDocument();
  });

  it('opens the agent drawer from the floating button and from the "/" key', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: 'Ask the agent' });
    fireEvent.click(button);
    expect(await screen.findByText('chat stub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close the agent' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Ask the agent' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('button', { name: 'Close the agent' })).toBeInTheDocument();
  });

  it('reaches the agent workspace from the nav, without the floating button', async () => {
    render(
      <MemoryRouter initialEntries={['/events/demo']}>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Agent' }));
    expect(await screen.findByRole('region', { name: 'Results' })).toBeInTheDocument();
    expect(document.querySelector('.shell')).toHaveClass('shell--agent', 'shell--rail');
    expect(screen.queryByRole('button', { name: 'Ask the agent' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.queryByRole('dialog', { name: 'Ask the agent' })).not.toBeInTheDocument();
  });

  it('opens venue results from the drawer in the workspace', async () => {
    render(
      <MemoryRouter initialEntries={['/events/demo']}>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask the agent' }));
    fireEvent.click(await screen.findByText('chat stub'));
    expect(await screen.findByRole('region', { name: 'Results' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor to Sign in, keeping the PayPal result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: 'not logged in' }), { status: 401 }))),
    );
    render(
      <MemoryRouter initialEntries={['/?login=denied']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Log in with PayPal' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("isn't allowed");
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('starts the sidebar as a rail on Plan, Money and Agent only', () => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/money']}>
        <App />
      </MemoryRouter>,
    );
    expect(container.querySelector('.shell')).toHaveClass('shell--rail');
    unmount();
    const home = render(
      <MemoryRouter initialEntries={['/approvals']}>
        <App />
      </MemoryRouter>,
    );
    expect(home.container.querySelector('.shell')).not.toHaveClass('shell--rail');
  });

  it('opens and closes the sidebar from its button, and remembers it across screens', async () => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/events/demo/plan']}>
        <App />
      </MemoryRouter>,
    );
    const shell = container.querySelector('.shell');
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
    expect(shell).not.toHaveClass('shell--rail');
    expect(screen.getByRole('button', { name: 'Close sidebar' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(await screen.findByRole('link', { name: 'Money' }));
    expect(shell).not.toHaveClass('shell--rail');
    unmount();

    const again = render(
      <MemoryRouter initialEntries={['/events/demo/money']}>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(again.container.querySelector('.shell')).toHaveClass('shell--rail');
  });

  it('closes the sidebar on the other screens too, and that choice carries to every screen', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/events/demo/approvals']}>
        <App />
      </MemoryRouter>,
    );
    const shell = container.querySelector('.shell');
    expect(shell).not.toHaveClass('shell--rail');
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(shell).toHaveClass('shell--rail');

    fireEvent.click(await screen.findByRole('link', { name: 'Rules' }));
    expect(shell).toHaveClass('shell--rail');
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
    fireEvent.click(screen.getByRole('link', { name: 'Plan' }));
    expect(shell).not.toHaveClass('shell--rail');
  });

  it('renders sponsor reports without organizer navigation or the agent button', () => {
    render(
      <MemoryRouter initialEntries={['/report/abc123token']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Sponsor report' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask the agent' })).not.toBeInTheDocument();
  });

  it('shows sign in with a way in for judges, outside the organizer shell', () => {
    render(
      <MemoryRouter initialEntries={['/signin?login=denied']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Log in with PayPal' })).toHaveAttribute('href', '/api/auth/paypal/login');
    expect(screen.getAllByRole('button', { name: 'Enter the demo' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent("isn't allowed");
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
