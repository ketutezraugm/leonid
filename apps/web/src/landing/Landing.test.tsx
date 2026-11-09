import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { LANDING } from '../brand';
import { nav } from './useEnterDemo';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

// /api/auth/me and the demo login answer as given; the events list is missing; everything else never settles.
function stubApi({ me = 401, demo = 200 }: { me?: number; demo?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).startsWith('/api/auth/me')) {
        return me === 200 ? json({ via: 'demo' }) : json({ error: 'not logged in' }, me);
      }
      if (String(url).startsWith('/api/auth/demo-login')) {
        return demo === 200 ? json({ ok: true }) : json({ error: 'not found' }, demo);
      }
      if (String(url).startsWith('/api/events')) return json({ error: 'not found' }, 404);
      return new Promise(() => {});
    }),
  );
}

function renderLanding(path = '/signin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => stubApi());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Landing page', () => {
  it('opens with the promise, the demo first, then PayPal, and says it is a sandbox', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your event’s money, kept by your rules.');
    expect(screen.getAllByRole('button', { name: 'Enter the demo' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Log in with PayPal' })).toHaveAttribute('href', '/api/auth/paypal/login');
    expect(screen.getByText('Runs on the PayPal sandbox. No real money moves.')).toBeInTheDocument();
  });

  it('names its sponsors in text only: no logos', () => {
    renderLanding();
    const built = screen.getByText('Built with').closest('.lp-built') as HTMLElement;
    for (const name of ['Bryntum Gantt', 'AG Studio', 'Channel3', 'Render', 'APIMatic']) {
      expect(within(built).getByText(name)).toBeInTheDocument();
    }
    expect(built.querySelector('img, svg')).toBeNull();
  });

  it('shows what went wrong with the PayPal login, in the hero', () => {
    renderLanding('/signin?login=denied');
    expect(screen.getByRole('alert')).toHaveTextContent("isn't allowed to use this event");
  });

  it('has every section a judge looks for', () => {
    renderLanding();
    for (const name of [
      'Your event, planned and paid, in one view.',
      'Only cleared money is spendable.',
      'Set the rules once. It never crosses them.',
      'A yes from you before anything big.',
      'The plan waits for the money.',
      'Try it in 3 minutes.',
      'How it works',
      'Rules are code, not prompts.',
      'Questions',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('img', { name: /Event home: \$1,140\.00 unlocked/ })).toHaveAttribute(
      'src',
      '/landing/event-home.png',
    );
  });

  it('has no testimonials and no invented numbers', () => {
    renderLanding();
    expect(screen.queryByText(/what people say/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hours a week|trusted by|\d+% /i)).not.toBeInTheDocument();
  });

  it('answers the FAQ with native disclosure, the first one open', () => {
    renderLanding();
    const first = screen.getByText('Is this real money?').closest('details') as HTMLDetailsElement;
    const second = screen.getByText('Can the agent spend without me?').closest('details') as HTMLDetailsElement;
    expect(first.open).toBe(true);
    expect(second.open).toBe(false);
  });

  it('does not promise several events until the server scopes them', () => {
    renderLanding();
    expect(LANDING.showMultiEvent).toBe(false);
    expect(screen.queryByText('Can I run more than one event?')).not.toBeInTheDocument();
  });

  it('shows what it pays while that section is switched on, and changes the phone with the item', () => {
    renderLanding();
    expect(LANDING.showPayouts).toBe(true);
    expect(screen.getByRole('heading', { name: 'Pays people back from a phone.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Prize payouts in one batch/ }));
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Prize payouts in one batch');
  });
});

describe('Entering the demo', () => {
  it('signs in with the demo login, then opens the app with a full navigation', async () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => {});
    renderLanding();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter the demo' })[0]!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/events'));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/auth/demo-login', expect.objectContaining({ method: 'POST' }));
  });

  it('opens each try-it card at its own moment', async () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => {});
    renderLanding();
    const cards = screen.getAllByRole('button', { name: 'Open in the demo ›' });
    expect(cards).toHaveLength(3);
    fireEvent.click(cards[1]!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/plan'));
  });

  it('says plainly when the server has the demo turned off', async () => {
    stubApi({ demo: 404 });
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => {});
    renderLanding();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enter the demo' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent("Demo sign-in isn't turned on for this server.");
    expect(assign).not.toHaveBeenCalled();
  });

  it('offers a signed-in visitor their events instead of a login', async () => {
    stubApi({ me: 200 });
    renderLanding();
    expect((await screen.findAllByRole('link', { name: 'Open your events' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Enter the demo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in with PayPal' })).not.toBeInTheDocument();
  });

  it('never runs the demo login over a signed-in visitor: the try-it cards just navigate', async () => {
    stubApi({ me: 200 });
    renderLanding();
    const cards = await screen.findAllByRole('link', { name: 'Open in the demo ›' });
    expect(cards.map((c) => c.getAttribute('href'))).toEqual(['/agent', '/plan', '/settings']);
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/auth/demo-login', expect.anything());
  });
});
