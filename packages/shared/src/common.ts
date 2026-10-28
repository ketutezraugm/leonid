import { z } from 'zod';

// Money is integer minor units (cents) plus an ISO 4217 code. Convert to PayPal's
// { currency_code, value: "140.00" } only at the PayPal client boundary.
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code in upper case');
export type CurrencyCode = z.infer<typeof CurrencyCode>;

export const MinorUnits = z.number().int().nonnegative();
export type MinorUnits = z.infer<typeof MinorUnits>;

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

// 2027-03-14
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

// 2026-10-27T10:00:00Z
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

// Output of the rules engine check(). P1 owns the engine; this is the shape it returns.
export const RuleDecision = z.enum(['allow', 'needs_approval', 'block']);
export type RuleDecision = z.infer<typeof RuleDecision>;

export const RuleResult = z.object({
  decision: RuleDecision,
  reasons: z.array(z.string()),
  ruleIds: z.array(z.string()),
});
export type RuleResult = z.infer<typeof RuleResult>;
