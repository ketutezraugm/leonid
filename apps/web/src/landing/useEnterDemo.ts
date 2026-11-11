import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, sendJson } from '../shell/api';

const parseOk = { parse: (value: unknown) => value };

// A full-page navigation, behind an object so a test can watch it without leaving the page.
export const nav = {
  assign: (target: string) => window.location.assign(target),
};

// A link can carry the judge access code (/signin?code=...) so a judge only has to click: it fills the field, and the
// code is then taken off the address bar so it does not stay in the history or a screenshot of the page.
const codeInLink = () => new URLSearchParams(window.location.search).get('code') ?? '';

// "Enter the demo" is how judges get in: P2's demo login gives a treasurer session with no PayPal account. It
// only works where the server turns it on (DEMO_LOGIN), and the hosted site also wants the judge access code
// (DEMO_LOGIN_CODE), so a refusal says which of the two it is instead of failing silently.
// The session is read once when the app loads, so a full navigation (not a router link) picks up the new cookie.
export function useEnterDemo() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(codeInLink);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('code')) return;
    params.delete('code');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  }, []);

  const enter = useCallback(
    async (target = '/events') => {
      const typed = code.trim();
      setBusy(true);
      setError(null);
      try {
        await sendJson('/api/auth/demo-login', parseOk, typed ? { code: typed } : undefined);
        nav.assign(target);
      } catch (err) {
        setBusy(false);
        const status = err instanceof ApiFailure ? err.status : 0;
        setError(
          status === 404
            ? "Demo sign-in isn't turned on for this server."
            : status === 401
              ? typed
                ? 'That access code is not right.'
                : 'Enter the judge access code from the submission notes, then press Enter the demo.'
              : status === 429
                ? 'Too many tries. Wait a few minutes and try again.'
                : "Couldn't sign in. Try again.",
        );
        // The buttons further down the page also land here: bring the field into view.
        if (status === 401) document.getElementById('lp-code')?.focus();
      }
    },
    [code],
  );

  return { enter, busy, error, code, setCode };
}
