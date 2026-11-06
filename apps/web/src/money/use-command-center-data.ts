import { useEffect, useState } from 'react';
import { CommandCenterResponse, type WidgetSource } from '@quartermaster/shared';
import { ApiFailure, getJson } from '../shell/api';
import { sampleCommandCenterData } from './sample-data';
import type { CommandCenterData } from './studio-data';

export type WidgetName = 'funding' | 'budget' | 'payouts' | 'rules' | 'delivery';

// Where a widget's numbers come from: our own ledger or audit log ('live'), rows the server says are made up
// until the real data exists ('sample'), or this browser's own sample because the server could not be asked
// ('offline').
export type Origin = WidgetSource | 'offline';

// Why the numbers are not the server's.
export type Problem = 'signed-out' | 'not-configured' | 'no-event' | 'unreachable' | 'bad-response';

export type CommandCenterState =
  | { status: 'loading' }
  | {
      status: 'ready';
      data: CommandCenterData;
      origins: Record<WidgetName, Origin>;
      problem: Problem | null;
    };

const OFFLINE: Record<WidgetName, Origin> = {
  funding: 'offline',
  budget: 'offline',
  payouts: 'offline',
  rules: 'offline',
  delivery: 'offline',
};

export function problemOf(err: unknown): Problem {
  if (err instanceof ApiFailure) {
    if (err.status === 401) return 'signed-out';
    if (err.status === 503) return 'not-configured';
    if (err.status === 404) return 'no-event';
    return 'unreachable';
  }
  // A response that is not in the shared shape is a server bug, not a missing connection.
  return err instanceof Error && err.name === 'ZodError' ? 'bad-response' : 'unreachable';
}

type Loaded = { data: CommandCenterData; origins: Record<WidgetName, Origin> };

// Asks the command-center endpoint (treasurer-only, so a signed-in session): all five widgets in one answer,
// parsed with the shared schema. All five or none: if any part is bad, the caller gets the failure, never a
// half-live page.
async function fetchCommandCenter(eventId?: string | null): Promise<Loaded> {
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
  const { funding, budget, payouts, rules, delivery } = await getJson(
    `/api/widgets/command-center${query}`,
    CommandCenterResponse,
  );
  return {
    data: {
      funding: funding.data,
      budget: budget.data,
      payouts: payouts.data,
      rules: rules.data,
      delivery: delivery.data,
    },
    origins: {
      funding: funding.source,
      budget: budget.source,
      payouts: payouts.source,
      rules: rules.source,
      delivery: delivery.source,
    },
  };
}

// One request per event at a time. The Money page starts it (prefetchCommandCenter) while AG Studio's large
// bundle is still downloading, and the command center then picks up that same request instead of asking
// again; a second mount (React's StrictMode, a quick tab switch) does too. A settled answer is reused for a
// short while only, so coming back to the page later shows fresh numbers. A failure is never reused.
const REUSE_MS = 15_000;
const requests = new Map<string, { promise: Promise<Loaded>; at: number }>();

export function loadCommandCenter(eventId?: string | null): Promise<Loaded> {
  const key = eventId ?? '';
  const now = Date.now();
  const kept = requests.get(key);
  if (kept && now - kept.at < REUSE_MS) return kept.promise;
  const promise = fetchCommandCenter(eventId);
  requests.set(key, { promise, at: now });
  promise.catch(() => {
    if (requests.get(key)?.promise === promise) requests.delete(key);
  });
  return promise;
}

export const prefetchCommandCenter = (eventId?: string | null): void => {
  loadCommandCenter(eventId).catch(() => {}); // the command center reports a failure when it asks
};

// For tests: each one starts with no request in flight.
export const forgetCommandCenterRequests = (): void => requests.clear();

// The command center's data. With no event id the server uses the seeded demo event. If the server cannot be
// asked, this falls back to the browser's own sample *as a whole*: sample sponsor ids would not match a live
// sponsor, so mixing the two would break the cross-filtering. The state says why, so the page can say so.
export function useCommandCenterData(eventId?: string | null): CommandCenterState {
  const [state, setState] = useState<CommandCenterState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    loadCommandCenter(eventId).then(
      ({ data, origins }) => {
        if (live) setState({ status: 'ready', data, origins, problem: null });
      },
      (err: unknown) => {
        if (live) {
          setState({
            status: 'ready',
            data: sampleCommandCenterData,
            origins: OFFLINE,
            problem: problemOf(err),
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [eventId]);

  return state;
}
