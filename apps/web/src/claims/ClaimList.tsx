import type { ClaimView } from '@leonid/shared';
import type { ReactNode } from 'react';
import { claimStatusView } from '../ui/claimStatus';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';
import './claims.css';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// One list for both screens. The volunteer sees their own claims; the treasurer also sees who claimed, and
// an action for a claim waiting on review (`action`).
export function ClaimList({
  claims,
  showName = false,
  action,
}: {
  claims: ClaimView[];
  showName?: boolean;
  action?: (claim: ClaimView) => ReactNode;
}) {
  return (
    <ul className="claim-list">
      {claims.map((c) => {
        const view = claimStatusView[c.status];
        return (
          <li key={c.id} className="claim-row">
            <div className="claim-main">
              <span className="claim-what">
                {showName && <strong>{c.volunteerName} · </strong>}
                {c.extracted?.merchant ?? 'Receipt'}
              </span>
              <span className="claim-amount">{c.amount === null ? '—' : formatMoney(c.amount, c.currency)}</span>
            </div>
            <div className="claim-meta">
              <StatusBadge status={view.status} label={view.label} />
              <span className="muted">{when(c.submittedAt)}</span>
            </div>
            {c.reasons.length > 0 && <p className="claim-reasons muted">{c.reasons.join('; ')}</p>}
            {action?.(c)}
          </li>
        );
      })}
    </ul>
  );
}
