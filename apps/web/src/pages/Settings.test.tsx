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
      if (url === '/api/approvals') return json({ approvals: [] });
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
  it('shows a revoke in the sidebar straight away', async () => {
    stubServer(200);
    await revoke();
    expect(await screen.findByRole('link', { name: 'Agent wallet · Revoked' })).toBeInTheDocument();
    expect(screen.queryByText(/deletion pending/)).not.toBeInTheDocument();
  });

  it('says the agent is stopped when PayPal could not delete the token yet, and offers a retry', async () => {
    stubServer(502);
    await revoke();
    expect(await screen.findByText('Agent stopped, PayPal deletion pending.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry deletion' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agent wallet · Revoked' })).toBeInTheDocument();
  });
});
