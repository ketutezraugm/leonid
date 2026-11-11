import { formatMoney } from './money';

// The funds-gated budget (invariant 2): unlocked = cleared income - committed spend. Invoiced and pledged
// money exists but is never spendable, so it is drawn as "hold", not as budget.
export interface BudgetFigures {
  currency: string;
  /** Cleared income: money PayPal has confirmed. */
  cleared: number;
  /** Spend already made or committed. */
  committed: number;
  /** Invoiced and not yet paid. */
  invoiced: number;
  /** Promised, not yet invoiced. */
  pledged: number;
}

export function unlockedToSpend(figures: Pick<BudgetFigures, 'cleared' | 'committed'>): number {
  return Math.max(0, figures.cleared - figures.committed);
}

export function BudgetBar({ figures }: { figures: BudgetFigures }) {
  const unlocked = unlockedToSpend(figures);
  const total = figures.committed + unlocked + figures.invoiced + figures.pledged;
  const pct = (cents: number) => (total === 0 ? 0 : (cents / total) * 100);
  const segments = [
    { key: 'committed', label: 'Committed', cents: figures.committed },
    { key: 'unlocked', label: 'Unlocked', cents: unlocked },
    { key: 'invoiced', label: 'Invoiced, not paid', cents: figures.invoiced },
    { key: 'pledged', label: 'Pledged', cents: figures.pledged },
  ];

  return (
    <div className="budget-bar">
      <div className="budget-bar-track" role="img" aria-label={segments.map((s) => `${s.label} ${formatMoney(s.cents, figures.currency)}`).join(', ')}>
        {segments.map((s) => (
          <span key={s.key} className={`budget-seg budget-seg--${s.key}`} style={{ width: `${pct(s.cents)}%` }} />
        ))}
      </div>
      <ul className="budget-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`budget-swatch budget-seg--${s.key}`} aria-hidden="true" />
            {s.label} <span className="num">{formatMoney(s.cents, figures.currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
