import { act, renderHook, waitFor } from '@testing-library/react';
import { CommandCenterResponse } from '@quartermaster/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../shell/api';
import { sampleCommandCenterData as sample } from './sample-data';
import {
  forgetCommandCenterRequests,
  loadCommandCenter,
  prefetchCommandCenter,
  problemOf,
  useCommandCenterData,
} from './use-command-center-data';

// What the server answers. The funding differs from the sample, so a test can tell whose it is.
const SERVER_FUNDING = { ...sample.funding, asOf: '2030-01-01T00:00:00Z' };
const answer = CommandCenterResponse.parse({
  funding: { source: 'live', data: SERVER_FUNDING },
  budget: { source: 'sample', data: sample.budget },
  payouts: { source: 'sample', data: sample.payouts },
  rules: { source: 'live', data: sample.rules },
  delivery: { source: 'sample', data: sample.delivery },
});

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

// Stands in for the network: the command-center endpoint answers well unless a test says otherwise.
function serve(override?: () => Response | Error) {
  const fetchMock = vi.fn((url: string) => {
    void url;
    const result = override?.() ?? json(answer);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => forgetCommandCenterRequests());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ready = async (eventId?: string | null) => {
  const hook = renderHook(({ id }) => useCommandCenterData(id), { initialProps: { id: eventId } });
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  const state = hook.result.current;
  if (state.status !== 'ready') throw new Error('not ready');
  return { ...hook, state };
};

const EVENT_A = '0b1d0b3e-6d9b-4a8e-9d2e-111111111111';
const EVENT_B = '0b1d0b3e-6d9b-4a8e-9d2e-222222222222';

describe('useCommandCenterData', () => {
  it('is loading until the server has answered', () => {
    serve();

    const { result } = renderHook(() => useCommandCenterData());

    expect(result.current).toEqual({ status: 'loading' });
  });

  it('makes one request for all five widgets, with the session cookie', async () => {
    const fetchMock = serve();

    await ready();

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    expect(calls.map(([url]) => url)).toEqual(['/api/widgets/command-center']);
    expect(calls[0]![1]).toMatchObject({ credentials: 'same-origin' });
  });

  it('uses what the server answered, and keeps what it said about where each number comes from', async () => {
    serve();

    const { state } = await ready();

    expect(state.problem).toBeNull();
    expect(state.data.funding.asOf).toBe('2030-01-01T00:00:00Z');
    expect(state.origins).toEqual({
      funding: 'live',
      budget: 'sample',
      payouts: 'sample',
      rules: 'live',
      delivery: 'sample',
    });
  });

  it('sends the event id', async () => {
    const fetchMock = serve();

    await ready(EVENT_A);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/widgets/command-center?eventId=${EVENT_A}`,
    ]);
  });

  it('asks again when the event changes', async () => {
    const fetchMock = serve();
    const { rerender } = await ready(EVENT_A);

    rerender({ id: EVENT_B });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).toContain(EVENT_B);
  });

  it.each([
    [401, 'signed-out'],
    [503, 'not-configured'],
    [404, 'no-event'],
    [500, 'unreachable'],
  ])('falls back to the sample, and says why, when the server answers %s', async (status, why) => {
    serve(() => json({ error: 'nope' }, status));

    const { state } = await ready();

    expect(state.problem).toBe(why);
    expect(state.data).toBe(sample);
  });

  it('falls back to the sample when the server cannot be reached at all', async () => {
    serve(() => new TypeError('Failed to fetch'));

    const { state } = await ready();

    expect(state.problem).toBe('unreachable');
    expect(state.data).toBe(sample);
  });

  it('is all live or all sample, never half and half: one bad part puts every widget on the sample', async () => {
    // Funding is live and fine, but the budget part is not in the shared shape. Live sponsor ids would not match
    // the sample rows, so the cross-filtering would break; the whole page is the sample instead.
    serve(() => json({ ...answer, budget: { source: 'live', data: { nonsense: true } } }));

    const { state } = await ready();

    expect(state.problem).toBe('bad-response');
    expect(state.data.funding.asOf).toBe(sample.funding.asOf);
    expect(Object.values(state.origins)).toEqual([
      'offline',
      'offline',
      'offline',
      'offline',
      'offline',
    ]);
  });

  it('ignores an answer that arrives after the page has been left', async () => {
    serve();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useCommandCenterData());

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('loadCommandCenter: one request per event at a time', () => {
  it('picks up the prefetched request instead of asking again', async () => {
    const fetchMock = serve();

    prefetchCommandCenter(EVENT_A);
    await ready(EVENT_A);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one request between two callers that ask at the same time (a double mount)', async () => {
    const fetchMock = serve();

    const [a, b] = await Promise.all([loadCommandCenter(EVENT_A), loadCommandCenter(EVENT_A)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('keeps events apart', async () => {
    const fetchMock = serve();

    await Promise.all([loadCommandCenter(EVENT_A), loadCommandCenter(EVENT_B)]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks again once the answer is no longer fresh, so a later visit shows new numbers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = serve();
    await loadCommandCenter(EVENT_A);

    act(() => vi.setSystemTime(Date.now() + 16_000));
    await loadCommandCenter(EVENT_A);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never reuses a failure: the next ask goes to the server again', async () => {
    let fail = true;
    const fetchMock = serve(() => (fail ? json({ error: 'boom' }, 500) : json(answer)));

    await expect(loadCommandCenter(EVENT_A)).rejects.toBeInstanceOf(ApiFailure);
    fail = false;
    const loaded = await loadCommandCenter(EVENT_A);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loaded.data.funding.asOf).toBe('2030-01-01T00:00:00Z');
  });
});

describe('problemOf', () => {
  it('reads an API failure by its status', () => {
    expect(problemOf(new ApiFailure(401, 'x'))).toBe('signed-out');
    expect(problemOf(new ApiFailure(503, 'x'))).toBe('not-configured');
    expect(problemOf(new ApiFailure(404, 'x'))).toBe('no-event');
    expect(problemOf(new ApiFailure(502, 'x'))).toBe('unreachable');
  });

  it('calls a shape error a bad response, and anything else unreachable', () => {
    const zod = new Error('bad shape');
    zod.name = 'ZodError';

    expect(problemOf(zod)).toBe('bad-response');
    expect(problemOf(new TypeError('Failed to fetch'))).toBe('unreachable');
    expect(problemOf('weird')).toBe('unreachable');
  });
});
