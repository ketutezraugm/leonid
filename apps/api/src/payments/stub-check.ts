import type { CheckResult, Spend } from './ports.js';

// Stand-in until the rules engine (P1, apps/api/src/rules/check) lands: the demo rule "nothing over $200 without approval".
// Replace with an adapter around the real check(); the executor only depends on the CheckSpend type.
//
// The threshold is in USD cents, so any other currency goes to a human instead of being compared by raw number
// (19,999 GBP pence is more than $200). The real check() must be currency-aware too, and should also cap the
// total spent per wallet/day (velocity), which this stub does not.
export const stubCheck = (spend: Spend): CheckResult => {
  if (spend.currency !== 'USD') {
    return { decision: 'needs_approval', reasons: [`${spend.currency} is not USD, so it needs a human to check the amount`], ruleIds: ['stub-currency'] };
  }
  return spend.amountMinor > 20_000
    ? { decision: 'needs_approval', reasons: ['over the $200 approval threshold'], ruleIds: ['stub-approval-threshold'] }
    : { decision: 'allow', reasons: ['within the auto-pay limit'], ruleIds: ['stub-approval-threshold'] };
};
