import type { Origin, Problem, WidgetName } from './use-command-center-data';

// What the command center says about where its numbers come from. A money screen that mixes real and made-up
// figures has to say which is which, in words, so nobody mistakes a sample for the ledger.
export interface SourceNote {
  // 'live': everything is the ledger's. 'sample': some or all of it is made-up. 'warning': the live numbers
  // could not be fetched, so everything shown is the browser's own sample.
  tone: 'live' | 'sample' | 'warning';
  text: string;
}

const NAMES: Record<WidgetName, string> = {
  funding: 'funding thermometer',
  budget: 'budget burn',
  rules: 'rules health',
  delivery: 'delivery risk',
  payouts: 'payouts ledger',
};

// The order the widgets sit on the page.
const ORDER: WidgetName[] = ['funding', 'budget', 'rules', 'delivery', 'payouts'];

const WHY: Record<Problem, string> = {
  'signed-out': 'sign in as the treasurer to see live numbers.',
  'not-configured': 'the server is not set up for the command center yet.',
  'no-event': 'there is no event set up yet.',
  unreachable: 'the server could not be reached.',
  'bad-response': 'the server sent something the command center could not read.',
};

const list = (names: WidgetName[]) => names.map((n) => NAMES[n]).join(', ');

export function describeSources(
  origins: Record<WidgetName, Origin>,
  problem: Problem | null,
): SourceNote {
  if (problem !== null) return { tone: 'warning', text: `Showing sample data: ${WHY[problem]}` };

  const live = ORDER.filter((n) => origins[n] === 'live');
  if (live.length === ORDER.length) {
    return { tone: 'live', text: 'Live numbers, from the ledger and the audit log.' };
  }
  const sample = ORDER.filter((n) => origins[n] !== 'live');
  if (live.length === 0) {
    return { tone: 'sample', text: `Sample data, until the real data exists: ${list(sample)}.` };
  }
  return {
    tone: 'sample',
    text: `Live from the ledger: ${list(live)}. Sample data, until the real data exists: ${list(sample)}.`,
  };
}
