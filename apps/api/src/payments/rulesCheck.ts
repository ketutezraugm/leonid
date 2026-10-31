import type { CompiledRules } from '@quartermaster/shared';
import type { Db } from '../db/client.js';
import { loadBudget } from '../db/budget.js';
import { check } from '../rules/check.js';
import { DEMO_RULES } from '../rules/demoRules.js';
import type { CheckSpend } from './ports.js';

// The real check() behind the executor's CheckSpend port: reads the budget for this spend, then decides.
export function createRulesCheck(
  db: Db,
  options: { rules?: CompiledRules; now?: () => Date } = {},
): CheckSpend {
  const rules = options.rules ?? DEMO_RULES;
  const now = options.now ?? (() => new Date());
  return async (spend) => check(spend, rules, await loadBudget(db, spend, now()));
}
