import type {
  BudgetBurnData,
  FundingThermometerData,
  TreasuryBalance,
  TreasuryResponse,
} from '@leonid/shared';
import type { BudgetFigures } from '../ui/BudgetBar';

// The funding widget's totals are cumulative (a paid sponsor counts as pledged, invoiced and cleared), while the
// budget bar draws each dollar once: invoiced means invoiced and not yet paid, pledged means not yet invoiced.
export function eventBudgetFigures(
  funding: FundingThermometerData,
  burn: BudgetBurnData,
): BudgetFigures {
  const { pledged, invoiced } = funding.totals;
  return {
    currency: burn.currency,
    cleared: burn.clearedIncome,
    committed: burn.committed,
    invoiced: Math.max(0, invoiced - burn.clearedIncome),
    pledged: Math.max(0, pledged - invoiced),
  };
}

// The PayPal account's balance in the event's currency; undefined when PayPal reports none in it.
export function paypalBalance(
  treasury: TreasuryResponse,
  currency: string,
): TreasuryBalance | undefined {
  return treasury.balances.find((b) => b.currency === currency.toUpperCase());
}
