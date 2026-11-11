import { describe, expect, it } from 'vitest';
import { describeSources } from './sources';
import type { Origin, Problem, WidgetName } from './use-command-center-data';

const origins = (over: Partial<Record<WidgetName, Origin>> = {}): Record<WidgetName, Origin> => ({
  funding: 'live',
  budget: 'live',
  payouts: 'live',
  rules: 'live',
  delivery: 'live',
  ...over,
});

describe('describeSources', () => {
  it('says so when every widget is live', () => {
    expect(describeSources(origins(), null)).toEqual({
      tone: 'live',
      text: 'Live numbers, from the ledger and the audit log.',
    });
  });

  it('names which widgets are live and which are sample, in the order they sit on the page', () => {
    const note = describeSources(
      origins({ budget: 'sample', payouts: 'sample', delivery: 'sample' }),
      null,
    );

    expect(note).toEqual({
      tone: 'sample',
      text: 'Live from the ledger: funding thermometer, rules health. Sample data, until the real data exists: budget burn, delivery risk, payouts ledger.',
    });
  });

  it('says plainly that everything is sample when nothing is live', () => {
    const none = origins({
      funding: 'sample',
      budget: 'sample',
      payouts: 'sample',
      rules: 'sample',
      delivery: 'sample',
    });

    expect(describeSources(none, null)).toEqual({
      tone: 'sample',
      text: 'Sample data, until the real data exists: funding thermometer, budget burn, rules health, delivery risk, payouts ledger.',
    });
  });

  it.each<[Problem, string]>([
    ['signed-out', 'Showing sample data: sign in as the treasurer to see live numbers.'],
    ['not-configured', 'Showing sample data: the server is not set up for the command center yet.'],
    ['no-event', 'Showing sample data: there is no event set up yet.'],
    ['unreachable', 'Showing sample data: the server could not be reached.'],
    [
      'bad-response',
      'Showing sample data: the server sent something the command center could not read.',
    ],
  ])('warns, in words, when the live numbers could not be fetched (%s)', (problem, text) => {
    const offline = origins({
      funding: 'offline',
      budget: 'offline',
      payouts: 'offline',
      rules: 'offline',
      delivery: 'offline',
    });

    expect(describeSources(offline, problem)).toEqual({ tone: 'warning', text });
  });

  it('puts a problem first, even if some origin says live', () => {
    expect(describeSources(origins(), 'unreachable').tone).toBe('warning');
  });
});
