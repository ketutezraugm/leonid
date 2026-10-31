import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalItem } from '@quartermaster/shared';
import { captureApproval, refusalMessage, waitingItems } from './capture';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

describe('captureApproval', () => {
  it('reports a successful capture as paid', async () => {
    stubFetch(200, { status: 'paid', captureId: 'CAP123' });
    expect(await captureApproval('a1')).toEqual({ kind: 'paid', paypalId: 'CAP123' });
  });

  it('treats 409 already_paid and in_progress as success, not an error', async () => {
    stubFetch(409, { status: 'refused', reason: 'already_paid' });
    expect(await captureApproval('a1')).toEqual({ kind: 'paid' });
    stubFetch(409, { status: 'refused', reason: 'in_progress' });
    expect(await captureApproval('a1')).toEqual({ kind: 'paid' });
  });

  it('treats other 409 reasons as real refusals with a plain message', async () => {
    stubFetch(409, { status: 'refused', reason: 'no_wallet' });
    const result = await captureApproval('a1');
    expect(result).toEqual({ kind: 'failed', message: "The agent can't buy anything until you connect a wallet." });
  });

  it('fails with a retryable message when PayPal errors', async () => {
    stubFetch(502, { status: 'failed' });
    const result = await captureApproval('a1');
    expect(result.kind).toBe('failed');
  });
});

describe('refusalMessage', () => {
  it('never says the charge happened when it was refused', () => {
    expect(refusalMessage(undefined)).toContain('Nothing was charged');
  });
});

describe('waitingItems', () => {
  const base = {
    referenceId: 'r',
    amountMinor: 100,
    currency: 'USD',
    actor: 'procurement',
    agentReason: 'x',
    reasons: [],
  };
  it('lists pending and capturing items oldest first and drops finished ones', () => {
    const items: ApprovalItem[] = [
      { ...base, id: 'new', status: 'pending', createdAt: '2027-01-02T00:00:00Z' },
      { ...base, id: 'done', status: 'paid', createdAt: '2027-01-01T00:00:00Z' },
      { ...base, id: 'old', status: 'capturing', createdAt: '2027-01-01T12:00:00Z' },
    ];
    expect(waitingItems(items).map((i) => i.id)).toEqual(['old', 'new']);
  });
});
