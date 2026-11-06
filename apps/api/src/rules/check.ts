import type { CompiledRules, Rule } from '@quartermaster/shared';
import type { CheckResult, Spend } from '../payments/ports.js';

// The rules engine (F9). Pure on purpose: no I/O, no clock, no randomness, no LLM. Everything it knows arrives as an
// argument, so a decision can be replayed from its audit row, and a model can never talk it out of one.
//
// It fails closed: what it cannot verify is never auto-paid. The strictest finding wins (block > needs_approval > allow).

// What the rules need to know about money, already in the spend's currency. db/budget.ts builds it.
export interface Budget {
  // Null when the spend names no event: there is no budget to check it against.
  funds: {
    unlockedMinor: number; // cleared income - committed spend
    committedByCategoryMinor: Readonly<Record<string, number>>; // keyed by normalized category
    paidSponsorIds: readonly string[];
  } | null;
  autoPaidTodayMinor: number; // charged to the agent wallet today, across every event
  claimedTodayMinor: number; // claimed today by this spend's payee
}

interface Finding {
  decision: 'needs_approval' | 'block';
  reason: string;
  ruleId: string;
}

const ask = (ruleId: string, reason: string): Finding => ({ decision: 'needs_approval', reason, ruleId });
const refuse = (ruleId: string, reason: string): Finding => ({ decision: 'block', reason, ruleId });

const money = (amountMinor: number, currency: string) => {
  const abs = Math.abs(amountMinor);
  const cents = String(abs % 100).padStart(2, '0');
  return `${amountMinor < 0 ? '-' : ''}${Math.floor(abs / 100)}.${cents} ${currency}`;
};

// So "Lanyard  Co" and "lanyard co" are one vendor, and a fullwidth lookalike is not a different one.
export const normalizeName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

// Who a claim is for, as far as the daily cap is concerned: the PayPal email the money goes to (so the same inbox under
// another name is the same person), else the name. undefined when the claim names neither.
// ponytail: an agent can still invent a new email for the same person; a registry of known, verified payees closes that.
export const payeeKey = (s: { payee?: string; payeeEmail?: string }): string | undefined => {
  const who = s.payeeEmail ?? s.payee;
  return who === undefined ? undefined : normalizeName(who);
};

const isCategoryScoped = (rule: Rule) => rule.type === 'approved_vendors' || rule.type === 'category_cap';

function checkFunds(spend: Spend, budget: Budget): Finding[] {
  const { funds } = budget;
  if (!funds) return [refuse('funds-gate', 'this spend names no event, so there is no budget to check it against')];
  const findings: Finding[] = [];
  if (spend.amountMinor > funds.unlockedMinor) {
    const asked = money(spend.amountMinor, spend.currency);
    const unlocked = money(funds.unlockedMinor, spend.currency);
    findings.push(refuse('funds-gate', `${asked} is more than the ${unlocked} of unlocked budget`));
  }
  if (spend.fundedBySponsorId && !funds.paidSponsorIds.includes(spend.fundedBySponsorId)) {
    findings.push(refuse('sponsor-gate', "this spend waits on a sponsor's invoice that is not paid yet"));
  }
  return findings;
}

type LimitRule = Exclude<Rule, { type: 'approved_vendors' }>;

function limitApplies(rule: LimitRule, spend: Spend): boolean {
  const kind = spend.kind ?? 'purchase';
  switch (rule.type) {
    case 'approval_threshold':
      return kind !== 'payout';
    case 'payout_threshold':
      return kind === 'payout';
    case 'claim_daily_cap':
      return kind === 'claim';
    case 'daily_auto_spend_cap':
      return true;
    case 'category_cap':
      return spend.category !== undefined && normalizeName(spend.category) === normalizeName(rule.category);
  }
}

function checkRule(rule: Rule, spend: Spend, budget: Budget): Finding[] {
  if (rule.type === 'approved_vendors') {
    const inCategory = spend.category !== undefined && normalizeName(spend.category) === normalizeName(rule.category);
    if ((spend.kind ?? 'purchase') !== 'purchase' || !inCategory) return [];
    const approved = rule.vendors.map(normalizeName);
    return spend.vendor !== undefined && approved.includes(normalizeName(spend.vendor))
      ? []
      : [refuse(rule.id, `${spend.vendor ?? 'no vendor'} is not on the approved ${rule.category} list`)];
  }
  if (!limitApplies(rule, spend)) return [];
  // Comparing raw numbers across currencies is wrong (19,999 pence is about $250), so a person looks at it instead.
  if (spend.currency !== rule.currency) {
    return [ask(rule.id, `${spend.currency} cannot be compared with a limit in ${rule.currency}, so a person needs to check it`)];
  }

  const limit = money(rule.amountMinor, rule.currency);
  switch (rule.type) {
    case 'approval_threshold':
    case 'payout_threshold':
      return spend.amountMinor > rule.amountMinor ? [ask(rule.id, `over the ${limit} approval threshold`)] : [];
    case 'daily_auto_spend_cap':
      return budget.autoPaidTodayMinor + spend.amountMinor > rule.amountMinor
        ? [ask(rule.id, `would pass the ${limit} the agent wallet may auto-pay per day`)]
        : [];
    case 'claim_daily_cap':
      if (payeeKey(spend) === undefined) return [ask(rule.id, 'this claim names no person, so the daily cap cannot be checked')];
      return budget.claimedTodayMinor + spend.amountMinor > rule.amountMinor
        ? [refuse(rule.id, `would pass the ${limit} a person may claim per day`)]
        : [];
    case 'category_cap': {
      const committed = budget.funds?.committedByCategoryMinor[normalizeName(rule.category)] ?? 0;
      return committed + spend.amountMinor > rule.amountMinor
        ? [refuse(rule.id, `would pass the ${limit} cap on ${rule.category}`)]
        : [];
    }
  }
}

export function check(spend: Spend, rules: CompiledRules, budget: Budget): CheckResult {
  const findings: Finding[] = [];
  if (!Number.isSafeInteger(spend.amountMinor) || spend.amountMinor <= 0) {
    findings.push(refuse('amount', 'the amount must be a positive whole number of minor units'));
  }
  findings.push(...checkFunds(spend, budget));
  if (rules.length === 0) findings.push(ask('no-rules', 'no confirmed rules are in force'));
  // Leaving the category off must not be a way around a category's rules.
  if (spend.category === undefined && rules.some(isCategoryScoped)) {
    findings.push(ask('category-required', 'this spend has no category, so the category rules cannot be checked'));
  }
  findings.push(...rules.flatMap((rule) => checkRule(rule, spend, budget)));

  const decision = findings.some((f) => f.decision === 'block')
    ? 'block'
    : findings.length > 0
      ? 'needs_approval'
      : 'allow';
  if (decision === 'allow') {
    return {
      decision,
      reasons: ['within the rules and the unlocked budget'],
      ruleIds: ['funds-gate', ...rules.map((rule) => rule.id)],
    };
  }
  const deciding = findings.filter((f) => f.decision === decision);
  return { decision, reasons: deciding.map((f) => f.reason), ruleIds: deciding.map((f) => f.ruleId) };
}
