import type { CheckSpend } from './ports.js';

// Stand-in until the rules engine (P1, apps/api/src/rules/check) lands: the demo rule "nothing over $200 without approval".
// Replace with an adapter around the real check(); the executor only depends on the CheckSpend type.
export const stubCheck: CheckSpend = (spend) =>
  spend.amountMinor > 20_000
    ? { decision: 'needs_approval', reasons: ['over the $200 approval threshold'], ruleIds: ['stub-approval-threshold'] }
    : { decision: 'allow', reasons: ['within the auto-pay limit'], ruleIds: ['stub-approval-threshold'] };
