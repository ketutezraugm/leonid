import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

vi.mock('../chat/AgentChat', () => ({ AgentChat: () => null }));

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

// A server whose wallet state changes on revoke, answering the revoke itself with `revokeStatus`.
function stubServer(revokeStatus: number) {
  let wallet = { status: 'active', payerEmail: 'agent@example.com' };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return json({ via: 'demo' });
      if (url === '/api/wallet') return json(wallet);
      if (url === '/api/wallet/revoke' && init?.method === 'POST') {
        wallet = { status: 'revoked', payerEmail: '' };
        return json(revokeStatus === 200 ? { revoked: true } : { error: 'wallet request failed' }, revokeStatus);
      }
      return json({ error: 'not set up' }, 503);
    }),
  );
}

async function revoke() {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke agent wallet' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke agent wallet' }));
}

afterEach(() => vi.unstubAllGlobals());

describe('Settings kill switch', () => {
  it('shows a revoke on the wallet card straight away', async () => {
    stubServer(200);
    await revoke();
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByText(/deletion pending/)).not.toBeInTheDocument();
  });

  it('says the agent is stopped when PayPal could not delete the token yet, and offers a retry', async () => {
    stubServer(502);
    await revoke();
    expect(await screen.findByText('Agent stopped, PayPal deletion pending.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry deletion' })).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });
});

// A server with a wallet that starts as given, a pool whose reset answers `resetStatus`, and a session of the given kind.
function stubRestore({ via, resetStatus, resetError = 'no standby wallet in the pool; the current wallet was not touched' }: { via: 'demo' | 'paypal'; resetStatus: number; resetError?: string }) {
  let wallet = { status: 'revoked', payerEmail: '' };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return json({ via });
      if (url === '/api/wallet') return json(wallet);
      if (url === '/api/wallet/pool/reset' && init?.method === 'POST') {
        if (resetStatus === 200) wallet = { status: 'active', payerEmail: 'agent@example.com' };
        return json(resetStatus === 200 ? { status: 'active', waiting: 0, standby: 3 } : { error: resetError }, resetStatus);
      }
      return json({ error: 'not set up' }, 503);
    }),
  );
}

function openSettings() {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <App />
    </MemoryRouter>,
  );
}

describe('Settings: restoring the demo wallet', () => {
  it('gives a judge a Restore button instead of Connect, and switches the wallet back on', async () => {
    stubRestore({ via: 'demo', resetStatus: 200 });
    openSettings();

    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect wallet' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore demo wallet' }));

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/wallet/pool/reset', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('button', { name: 'Revoke agent wallet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore demo wallet' })).not.toBeInTheDocument();
  });

  it('says so when no spare wallet is left', async () => {
    stubRestore({ via: 'demo', resetStatus: 409 });
    openSettings();

    fireEvent.click(await screen.findByRole('button', { name: 'Restore demo wallet' }));

    expect(await screen.findByText('No spare demo wallet is left. Ask the host to add one.')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });

  it('keeps Connect wallet for a real PayPal login, and offers no restore', async () => {
    stubRestore({ via: 'paypal', resetStatus: 200 });
    openSettings();

    expect(await screen.findByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore demo wallet' })).not.toBeInTheDocument();
  });
});
