import { TreasuryResponse } from '@leonid/shared';
import { errorMessage, useFetch } from '../shell/api';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';

// The treasury is the app's own PayPal account, set up on the server (F2): there is nothing to connect, only to
// confirm. Shown in Settings and in the setup flow.
export function TreasuryStatus() {
  const treasury = useFetch('/api/treasury', TreasuryResponse);

  if (treasury.kind === 'loading') return <p className="muted">Loading the balance…</p>;
  if (treasury.kind === 'error') {
    return (
      <p className="muted">
        {errorMessage(treasury.error).title}. {errorMessage(treasury.error).detail}
      </p>
    );
  }
  return (
    <>
      <p>
        <StatusBadge status="done" label="Treasury connected" />
      </p>
      {treasury.data.balances.map((b) => (
        <p key={b.currency}>
          Balance <strong className="num">{formatMoney(b.totalMinor, b.currency)}</strong>
          {treasury.data.asOf && (
            <span className="muted"> as of {new Date(treasury.data.asOf).toLocaleString()}</span>
          )}
        </p>
      ))}
      <p className="muted">
        This is PayPal’s own balance and it lags. What the agent may spend is worked out from
        cleared income.
      </p>
    </>
  );
}
