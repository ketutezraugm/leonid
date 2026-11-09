import { BudgetBurnResponse, FundingThermometerResponse, TreasuryResponse } from '@leonid/shared';
import { errorMessage, useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { BudgetBar } from '../ui/BudgetBar';
import { Button } from '../ui/Button';
import { formatMoney } from '../ui/money';
import { eventBudgetFigures, paypalBalance } from './budget';

// The headline is the PayPal account's own balance (GET /api/treasury), the money the agent actually pays from now
// that cleared sponsor income no longer gates spending. The bar under it is the event's live ledger: cleared and
// committed from budget burn, invoiced and pledged from the funding widget. Each half loads and fails on its own.
export function BalanceCard() {
  const event = useEvent();
  const treasury = useFetch('/api/treasury', TreasuryResponse);
  const funding = useFetch(withEvent('/api/widgets/funding', event), FundingThermometerResponse);
  const burn = useFetch(withEvent('/api/widgets/budget-burn', event), BudgetBurnResponse);

  const balance = treasury.kind === 'ready' ? paypalBalance(treasury.data, event.currency) : undefined;

  return (
    <section className="unlocked" aria-labelledby="unlocked-title">
      <h2 id="unlocked-title">PayPal balance</h2>
      {treasury.kind === 'loading' && (
        <p className="unlocked-figure num" aria-busy="true">
          …
        </p>
      )}
      {treasury.kind === 'error' && (
        <>
          <p className="unlocked-figure num">—</p>
          <p className="muted unlocked-rule">
            {errorMessage(treasury.error).title}. {errorMessage(treasury.error).detail}
          </p>
          <div className="btn-row">
            <Button variant="secondary" onClick={treasury.reload}>
              Try again
            </Button>
          </div>
        </>
      )}
      {treasury.kind === 'ready' && (
        <>
          <p className="unlocked-figure num">{formatMoney(balance?.totalMinor ?? 0, event.currency)}</p>
          <p className="muted unlocked-rule">
            What the agent pays from, straight from PayPal
            {treasury.data.asOf && <> as of {new Date(treasury.data.asOf).toLocaleString()}</>}. PayPal’s figure can lag
            a few minutes behind a payment; the rules, not this number, decide what the agent may spend.
          </p>
        </>
      )}

      {funding.kind === 'ready' && burn.kind === 'ready' ? (
        <BudgetBar figures={eventBudgetFigures(funding.data.data, burn.data.data)} />
      ) : funding.kind === 'error' || burn.kind === 'error' ? (
        <p className="muted">
          Couldn’t load this event’s sponsor money and spend.{' '}
          <Button
            variant="secondary"
            onClick={() => {
              funding.reload();
              burn.reload();
            }}
          >
            Try again
          </Button>
        </p>
      ) : (
        <p className="muted" role="status">
          Loading sponsor money and spend…
        </p>
      )}
    </section>
  );
}
