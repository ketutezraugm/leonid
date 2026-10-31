import { useCallback, useState } from 'react';
import { ApiFailure, sendJson } from '../shell/api';

const parseOk = { parse: (value: unknown) => value };

// A full-page navigation, behind an object so a test can watch it without leaving the page.
export const nav = {
  assign: (target: string) => window.location.assign(target),
};

// "Enter the demo" is how judges get in: P2's demo login gives a treasurer session with no PayPal account. It
// only works where the server turns it on (DEMO_LOGIN), so a refusal says so instead of failing silently.
// The session is read once when the app loads, so a full navigation (not a router link) picks up the new cookie.
export function useEnterDemo() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = useCallback(async (target = '/events') => {
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/auth/demo-login', parseOk);
      nav.assign(target);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof ApiFailure && err.status === 404
          ? "Demo sign-in isn't turned on for this server."
          : "Couldn't sign in. Try again.",
      );
    }
  }, []);

  return { enter, busy, error };
}
