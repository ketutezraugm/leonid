import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../shell/session';
import { Profile } from './Profile';

afterEach(() => vi.unstubAllGlobals());

describe('Profile', () => {
  it('shows who is signed in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).startsWith('/api/auth/me')
          ? Promise.resolve(new Response(JSON.stringify({ email: 'ada@example.com', via: 'paypal' }), { headers: { 'content-type': 'application/json' } }))
          : new Promise(() => {}),
      ),
    );
    render(
      <MemoryRouter>
        <SessionProvider>
          <Profile />
        </SessionProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
