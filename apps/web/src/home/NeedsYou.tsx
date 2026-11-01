import { Link } from 'react-router-dom';
import type { ApprovalItem } from '@quartermaster/shared';
import type { FetchState } from '../shell/api';
import { useEventPath } from '../shell/event';
import { Button } from '../ui/Button';
import { formatMoney } from '../ui/money';

// What needs the treasurer. Its busiest moment and its calmest moment must look different: a waiting item is the
// loudest thing on Event home; an empty queue is one quiet line. A failed load never reads as "nothing waiting".
export function NeedsYou({
  state,
  waiting,
  onRetry,
}: {
  state: FetchState<unknown>['kind'];
  waiting: ApprovalItem[];
  onRetry: () => void;
}) {
  const path = useEventPath();
  if (state === 'loading') {
    return (
      <section className="needs needs--quiet" aria-label="Needs you" aria-busy="true">
        <p className="muted" role="status">
          Checking approvals…
        </p>
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section className="needs needs--problem" aria-label="Needs you">
        <h2>Couldn’t load approvals</h2>
        <p className="muted">Something may be waiting on you. Check again, or open Approvals.</p>
        <div className="btn-row">
          <Button onClick={onRetry}>Try again</Button>
          <Link to={path('approvals')} className="btn btn-secondary">
            Open Approvals
          </Link>
        </div>
      </section>
    );
  }

  const oldest = waiting[0];
  if (!oldest) {
    return (
      <section className="needs needs--quiet" aria-label="Needs you">
        <p>
          <span className="needs-check" aria-hidden="true" />
          Nothing is waiting on you.
        </p>
      </section>
    );
  }

  const more = waiting.length - 1;
  return (
    <section className="needs needs--waiting" aria-label="Needs you">
      <h2>
        Needs you <span className="needs-count">{waiting.length}</span>
      </h2>
      <p className="needs-item">
        <strong>{oldest.vendor ?? oldest.category ?? oldest.referenceId}</strong>
        <span className="needs-amount num">{formatMoney(oldest.amountMinor, oldest.currency)}</span>
      </p>
      {oldest.reasons[0] && <p className="needs-reason">{oldest.reasons[0]}</p>}
      <div className="btn-row">
        <Link to={path('approvals')} className="btn btn-primary">
          Review in Approvals
        </Link>
      </div>
      {more > 0 && <p className="muted needs-more">and {more} more waiting</p>}
    </section>
  );
}
