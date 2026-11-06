import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@quartermaster/shared';

// The browser talks only to our own /api (invariant 4: never to PayPal's server APIs).
// Every response is parsed at this boundary; a failure carries the HTTP status so a screen
// can tell "sign in again" (401) from "not set up on this server" (503) from a real error.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export interface Parser<T> {
  parse(value: unknown): T;
}

async function readFailure(res: Response): Promise<ApiFailure> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiError.safeParse(body);
  return new ApiFailure(res.status, parsed.success ? parsed.data.error : `HTTP ${res.status}`, body);
}

export async function getJson<T>(url: string, parser: Parser<T>): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw await readFailure(res);
  return parser.parse(await res.json());
}

export async function sendJson<T>(
  url: string,
  parser: Parser<T>,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // 409 from capture carries a meaningful body (already paid), so callers read it from the failure.
  if (!res.ok) throw await readFailure(res);
  return parser.parse(await res.json());
}

// For endpoints that answer 204 with no body, e.g. a delete.
export async function sendNoContent(url: string, method = 'DELETE'): Promise<void> {
  const res = await fetch(url, { method, credentials: 'same-origin' });
  if (!res.ok) throw await readFailure(res);
}

export type FetchState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'error'; error: ApiFailure };

// Fetch on mount (and on reload()). The latest request wins; a stale response never overwrites a newer one.
export type Fetched<T> = FetchState<T> & { reload: () => void; refresh: () => void };

// reload() shows the loading state again; refresh(), or a new refreshKey, swaps the data in quietly.
export function useFetch<T>(url: string, parser: Parser<T>, refreshKey?: string): Fetched<T> {
  const [state, setState] = useState<FetchState<T>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getJson(url, parser)
      .then((data) => !cancelled && setState({ kind: 'ready', data }))
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof ApiFailure ? err : new ApiFailure(0, 'Could not reach the server');
        setState({ kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
    // parser is a module-level constant at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, refreshKey]);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setTick((n) => n + 1);
  }, []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload, refresh };
}

export function errorMessage(error: ApiFailure): { title: string; detail: string } {
  if (error.status === 401) {
    return { title: 'Your session expired', detail: 'Sign in again to continue.' };
  }
  if (error.status === 503) {
    return {
      title: 'Not set up on this server yet',
      detail: 'This needs PayPal or login settings that are missing here.',
    };
  }
  if (error.status === 0) {
    return { title: "Couldn't reach the server", detail: 'Check your connection, then try again.' };
  }
  return { title: 'Something went wrong', detail: 'Try again in a moment.' };
}
