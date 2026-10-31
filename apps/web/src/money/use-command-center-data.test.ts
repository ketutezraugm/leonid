import { renderHook, waitFor } from '@testing-library/react';
import {
  BudgetBurnResponse,
  DeliveryRiskResponse,
  FundingThermometerResponse,
  PayoutsLedgerResponse,
  RulesHealthResponse,
} from '@quartermaster/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../shell/api';
import { sampleCommandCenterData as sample } from './sample-data';
import { problemOf, useCommandCenterData } from './use-command-center-data';

// What the server answers, by endpoint. The funding differs from the sample, so a test can tell whose it is.
const SERVER_FUNDING = { ...sample.funding, asOf: '2030-01-01T00:00:00Z' };
const answers = {
  funding: FundingThermometerResponse.parse({ source: 'live', data: SERVER_FUNDING }),
  'budget-burn': BudgetBurnResponse.parse({ source: 'sample', data: sample.budget }),
  payouts: PayoutsLedgerResponse.parse({ source: 'sample', data: sample.payouts }),
  'rules-health': RulesHealthResponse.parse({ source: 'live', data: sample.rules }),
  'delivery-risk': DeliveryRiskResponse.parse({ source: 'sample', data: sample.delivery }),
};
type Endpoint = keyof typeof answers;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

// Stands in for the network: every endpoint answers well unless a test says otherwise.
function serve(overrides: Partial<Record<Endpoint, Response | Error>> = {}) {
  const fetchMock = vi.fn((url: string) => {
    const endpoint = new URL(url, 'http://localhost').pathname.split('/').pop() as Endpoint;
    const override = overrides[endpoint];
    if (override instanceof Error) return Promise.reject(override);
    return Promise.resolve(override ?? json(answers[endpoint]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const ready = async (eventId?: string | null) => {
  const hook = renderHook(({ id }) => useCommandCenterData(id), { initialProps: { id: eventId } });
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  const state = hook.result.current;
  if (state.status !== 'ready') throw new Error('not ready');
  return { ...hook, state };
};

describe('useCommandCenterData', () => {
  it('is loading until the server has answered', () => {
    serve();

    const { result } = renderHook(() => useCommandCenterData());

    expect(result.current).toEqual({ status: 'loading' });
  });

  it('asks the five widget endpoints with the session cookie', async () => {
    const fetchMock = serve();

    await ready();

    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/widgets/budget-burn',
      '/api/widgets/delivery-risk',
      '/api/widgets/funding',
      '/api/widgets/payouts',
      '/api/widgets/rules-health',
    ]);
    // fetch(url, init): the mock was declared with the url only, so say what the calls really carry.
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    for (const [, init] of calls) expect(init).toMatchObject({ credentials: 'same-origin' });
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

  it('sends the event id to the endpoints that take one, and not to rules health', async () => {
    const fetchMock = serve();

    await ready('0b1d0b3e-6d9b-4a8e-9d2e-111111111111');

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(
      urls.filter((u) => u.includes('eventId=0b1d0b3e-6d9b-4a8e-9d2e-111111111111')),
    ).toHaveLength(4);
    expect(urls.find((u) => u.includes('rules-health'))).toBe('/api/widgets/rules-health');
  });

  it('asks again when the event changes', async () => {
    const fetchMock = serve();
    const { rerender } = await ready('0b1d0b3e-6d9b-4a8e-9d2e-111111111111');

    rerender({ id: '0b1d0b3e-6d9b-4a8e-9d2e-222222222222' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(10));
  });

  it.each([
    [401, 'signed-out'],
    [503, 'not-configured'],
    [404, 'no-event'],
    [500, 'unreachable'],
  ])('falls back to the sample, and says why, when an endpoint answers %s', async (status, why) => {
    serve({ funding: json({ error: 'nope' }, status) });

    const { state } = await ready();

    expect(state.problem).toBe(why);
    expect(state.data).toBe(sample);
  });

  it('falls back to the sample when the server cannot be reached at all', async () => {
    serve({ payouts: new TypeError('Failed to fetch') });

    const { state } = await ready();

    expect(state.problem).toBe('unreachable');
    expect(state.data).toBe(sample);
  });

  it('falls back, and says the answer was unreadable, when it is not in the shared shape', async () => {
    serve({ 'budget-burn': json({ source: 'live', data: { nonsense: true } }) });

    const { state } = await ready();

    expect(state.problem).toBe('bad-response');
    expect(state.data).toBe(sample);
  });

  it('is all live or all sample, never half and half: one failure puts every widget on the sample', async () => {
    // Funding is live and fine, but the payouts failed. Live sponsor ids would not match the sample payouts, so
    // the cross-filtering would break; the whole page is the sample instead.
    serve({ payouts: json({ error: 'boom' }, 500) });

    const { state } = await ready();

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
