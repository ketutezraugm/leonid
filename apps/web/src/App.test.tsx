import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// The drawer's chat is P1's and has its own tests; here it is a stub so we test only the shell.
vi.mock('./chat/AgentChat', () => ({ AgentChat: () => <p>chat stub</p> }));

beforeEach(() => {
  // Requests never settle: these tests check the first render only.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('renders the shell and event home', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText('Quartermaster')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Event home' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
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

  it('collapses the sidebar to a rail on Plan and Money only', () => {
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
    expect(screen.getByRole('button', { name: 'Enter demo as treasurer' })).toBeInTheDocument();
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
