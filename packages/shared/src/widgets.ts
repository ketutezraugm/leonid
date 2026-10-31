import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, MinorUnits, RuleResult } from './common.js';
import { PayoutItem } from './payout.js';

// Query string shared by every widget endpoint, so one click in a widget can filter the rest.
export const WidgetFilter = z.object({
  sponsorId: Id.optional(),
  category: z.string().min(1).optional(),
});
export type WidgetFilter = z.infer<typeof WidgetFilter>;

// Funding thermometer: pledged vs invoiced vs cleared, per sponsor.
export const SponsorFunding = z.object({
  sponsorId: Id,
  name: z.string().min(1),
  tier: z.string().min(1),
  pledged: MinorUnits,
  invoiced: MinorUnits,
  cleared: MinorUnits,
});
export type SponsorFunding = z.infer<typeof SponsorFunding>;

export const FundingThermometerData = z.object({
  asOf: IsoDateTime,
  currency: CurrencyCode,
  sponsors: z.array(SponsorFunding),
  totals: z.object({ pledged: MinorUnits, invoiced: MinorUnits, cleared: MinorUnits }),
});
export type FundingThermometerData = z.infer<typeof FundingThermometerData>;

// Budget burn: spend vs unlocked budget by category, days to event.
export const BudgetCategoryBurn = z.object({
  category: z.string().min(1),
  // Null when the treasurer set no cap for the category.
  cap: MinorUnits.nullable(),
  spent: MinorUnits,
  committed: MinorUnits,
});
export type BudgetCategoryBurn = z.infer<typeof BudgetCategoryBurn>;

export const BudgetBurnData = z.object({
  asOf: IsoDateTime,
  currency: CurrencyCode,
  eventDate: IsoDate,
  // Negative once the event has passed.
  daysToEvent: z.number().int(),
  clearedIncome: MinorUnits,
  committed: MinorUnits,
  // clearedIncome - committed. Can go negative only if something bypassed the budget, which the widget should flag.
  unlocked: z.number().int(),
  categories: z.array(BudgetCategoryBurn),
});
export type BudgetBurnData = z.infer<typeof BudgetBurnData>;

// Payouts ledger (grid): claims, speaker payments and prizes with status.
export const PayoutsLedgerData = z.object({
  asOf: IsoDateTime,
  rows: z.array(PayoutItem),
});
export type PayoutsLedgerData = z.infer<typeof PayoutsLedgerData>;

// Rules health: allowed, sent to approval and blocked, with reasons.
export const RulesHealthEntry = z.object({
  auditId: Id,
  at: IsoDateTime,
  actor: z.string().min(1),
  action: z.string().min(1),
  amount: MinorUnits.nullable(),
  currency: CurrencyCode.nullable(),
  sponsorId: Id.nullable(),
  category: z.string().min(1).nullable(),
  result: RuleResult,
});
export type RulesHealthEntry = z.infer<typeof RulesHealthEntry>;

export const RulesHealthData = z.object({
  asOf: IsoDateTime,
  counts: z.object({
    allow: z.number().int().nonnegative(),
    needsApproval: z.number().int().nonnegative(),
    block: z.number().int().nonnegative(),
  }),
  recent: z.array(RulesHealthEntry),
});
export type RulesHealthData = z.infer<typeof RulesHealthData>;

// Delivery risk: items whose expected arrival is after their deadline.
export const DeliveryRisk = z.enum(['late', 'at_risk', 'on_track', 'unknown']);
export type DeliveryRisk = z.infer<typeof DeliveryRisk>;

export const DeliveryRiskItem = z.object({
  orderId: Id,
  taskId: Id.nullable(),
  name: z.string().min(1),
  sponsorId: Id.nullable(),
  category: z.string().min(1),
  trackingNumber: z.string().nullable(),
  // Null until tracking gives a date.
  expectedDelivery: IsoDate.nullable(),
  deadline: IsoDate,
  // Days past the deadline; zero or negative means slack.
  daysLate: z.number().int(),
  risk: DeliveryRisk,
});
export type DeliveryRiskItem = z.infer<typeof DeliveryRiskItem>;

export const DeliveryRiskData = z.object({
  asOf: IsoDateTime,
  items: z.array(DeliveryRiskItem),
});
export type DeliveryRiskData = z.infer<typeof DeliveryRiskData>;

// Where a widget's numbers come from. 'sample' means the owner's data does not exist yet; the command
// center must label it so nobody mistakes it for the ledger.
export const WidgetSource = z.enum(['live', 'sample']);
export type WidgetSource = z.infer<typeof WidgetSource>;

export const widgetResponse = <T extends z.ZodType>(data: T) =>
  z.object({ source: WidgetSource, data });

export const FundingThermometerResponse = widgetResponse(FundingThermometerData);
export type FundingThermometerResponse = z.infer<typeof FundingThermometerResponse>;

export const RulesHealthResponse = widgetResponse(RulesHealthData);
export type RulesHealthResponse = z.infer<typeof RulesHealthResponse>;

export const BudgetBurnResponse = widgetResponse(BudgetBurnData);
export type BudgetBurnResponse = z.infer<typeof BudgetBurnResponse>;

export const DeliveryRiskResponse = widgetResponse(DeliveryRiskData);
export type DeliveryRiskResponse = z.infer<typeof DeliveryRiskResponse>;
