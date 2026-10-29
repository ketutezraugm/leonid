import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiFailure, getJson, sendJson } from './api';

// Who is signed in. 'signed-out' is a 401 from /api/auth/me; 'unconfigured' is a 503 (this server has no
// login settings, as on a fresh dev checkout), which we do not treat as signed out so local work still opens.
export type Session =
  | { status: 'loading' }
  | { status: 'signed-in'; email?: string; via: 'paypal' | 'demo' }
  | { status: 'signed-out' }
  | { status: 'unconfigured' };

interface SessionValue {
  session: Session;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  session: { status: 'loading' },
  signOut: async () => {},
});

const parseMe = {
  parse(value: unknown): { email?: string; via: 'paypal' | 'demo' } {
    const v = value as { email?: unknown; via?: unknown } | null;
    if (!v || (v.via !== 'paypal' && v.via !== 'demo')) throw new Error('Unexpected /api/auth/me response');
    return { email: typeof v.email === 'string' ? v.email : undefined, via: v.via };
  },
};
const parseOk = { parse: (value: unknown) => value };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getJson('/api/auth/me', parseMe)
      .then((me) => !cancelled && setSession({ status: 'signed-in', ...me }))
      .catch((err: unknown) => {
        if (cancelled) return;
        setSession({ status: err instanceof ApiFailure && err.status === 401 ? 'signed-out' : 'unconfigured' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await sendJson('/api/auth/logout', parseOk).catch(() => undefined);
    setSession({ status: 'signed-out' });
  }, []);

  const value = useMemo(() => ({ session, signOut }), [session, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
