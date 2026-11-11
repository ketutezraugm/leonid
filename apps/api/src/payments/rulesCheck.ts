import type { CompiledRules } from '@leonid/shared';
import type { Db } from '../db/client.js';
import { loadBudget } from '../db/budget.js';
import { getEvent } from '../db/events.js';
import { check } from '../rules/check.js';
import { DEMO_RULES } from '../rules/demoRules.js';
import type { CheckSpend } from './ports.js';

// The real check() behind the executor's CheckSpend port: reads the budget for this spend, then decides.
// The event's maximum spend, when the organizer set one, joins the rules for that spend. Its currency is the event's,
// so a spend in another currency goes to a person like any other limit it cannot be compared with.
export function createRulesCheck(
  db: Db,
  options: { rules?: CompiledRules; now?: () => Date } = {},
): CheckSpend {
  const rules = options.rules ?? DEMO_RULES;
  const now = options.now ?? (() => new Date());
  return async (spend) => {
    const event = spend.eventId ? await getEvent(db, spend.eventId) : undefined;
    const withMax: CompiledRules =
      event?.maxSpendMinor == null
        ? rules
        : [...rules, { id: 'max-spend', type: 'max_spend', amountMinor: event.maxSpendMinor, currency: event.currency }];
    return check(spend, withMax, await loadBudget(db, spend, now()));
  };
}
