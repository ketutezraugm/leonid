import { describe, expect, it } from 'vitest';
import { scriptedModel } from '../agents/testing.js';
import { buildReport } from './build.js';
import { figuresText, templateNarrative, usesOnlyGivenNumbers, writeNarrative } from './narrative.js';

const A = '00000000-0000-4000-8000-00000000000a';
const data = buildReport({
  sponsor: { id: A, name: 'Harbor Cloud', tier: 'gold', pledged: 300_000, status: 'paid' },
  event: { name: 'OpenHack 2027', date: new Date('2027-03-14T00:00:00Z'), currency: 'USD' },
  clearedBySponsor: new Map([[A, 300_000]]),
  clearedTotal: 300_000,
  now: new Date('2026-11-05T12:00:00Z'),
  spends: [
    { id: 's1', at: '2026-11-04T10:00:00.000Z', actor: 'agent', amountMinor: 14_000, currency: 'USD', category: 'swag', vendor: 'Lanyard Co', agentReason: null, decision: 'allow', reasons: [], status: 'paid', paypalId: 'PP-1', eventId: 'e1' },
  ],
});

describe('writeNarrative', () => {
  it('uses the model summary when every number in it was given', async () => {
    const n = await writeNarrative(data, scriptedModel([{ text: 'Thank you, Harbor Cloud. $140.00 of your $3,000.00 went to swag from Lanyard Co.' }]));
    expect(n.source).toBe('ai');
    expect(n.text).toContain('$140.00');
  });

  it('throws away a summary with a number it was not given, and uses the template', async () => {
    const n = await writeNarrative(data, scriptedModel([{ text: 'You helped 500 people and $140.00 went to swag.' }]));
    expect(n.source).toBe('template');
    expect(n.text).not.toContain('500');
  });

  it('uses the template with no model, when the model fails, and when it answers with nothing', async () => {
    expect((await writeNarrative(data, undefined)).source).toBe('template');
    expect((await writeNarrative(data, scriptedModel([]))).source).toBe('template'); // script exhausted: the call throws
    expect((await writeNarrative(data, scriptedModel([{ text: '   ' }]))).source).toBe('template');
  });

  it('gives the model only the figures and vendor names as plain lines', () => {
    expect(figuresText(data)).toContain('Vendor: Lanyard Co');
    expect(figuresText(data)).toContain('$140.00');
  });
});

describe('usesOnlyGivenNumbers', () => {
  it('compares numbers by value, so $140 and 140.00 and 1,400 are told apart', () => {
    expect(usesOnlyGivenNumbers('$140 for swag', 'Category swag: $140.00')).toBe(true);
    expect(usesOnlyGivenNumbers('$1,400 for swag', 'Category swag: $140.00')).toBe(false);
  });
});

describe('templateNarrative', () => {
  it('says plainly when nothing has been spent', () => {
    const empty = { ...data, spend: { ...data.spend, totalMinor: 0, byCategory: [], lines: [] } };
    expect(templateNarrative(empty).text).toContain('none of it has been spent yet');
  });
});
