import { useState } from 'react';
import {
  SPEND_RECENT_MAX,
  SpendsResponse,
  type RuleDecision,
  type SpendEntry,
} from '@leonid/shared';
import { errorMessage, useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { CopyId } from '../ui/CopyId';
import { formatMoney } from '../ui/money';
import { StatusBadge, type Status } from '../ui/StatusBadge';

const decisions: Record<RuleDecision, { status: 'done' | 'risk' | 'blocked'; label: string }> = {
  allow: { status: 'done', label: 'Allowed' },
  needs_approval: { status: 'risk', label: 'Needs approval' },
  block: { status: 'blocked', label: 'Blocked' },
};

// How the spend ended, when that says more than the rules' decision (an allowed spend PayPal refused after the kill switch).
const outcomes: Partial<
  Record<SpendEntry['status'], { status: 'progress' | 'blocked'; label: string }>
> = {
  capturing: { status: 'progress', label: 'Paying' },
  submitted: { status: 'progress', label: 'Sending' }, // a payout PayPal accepted and has not finished
  rejected: { status: 'blocked', label: 'Rejected' },
  refused: { status: 'blocked', label: 'Refused' },
  failed: { status: 'blocked', label: 'Failed' },
  error: { status: 'blocked', label: 'Failed' },
  mismatch: { status: 'blocked', label: 'Failed' },
};

function ledgerDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

function Verdict({ status, label, reason }: { status: Status; label: string; reason?: string }) {
  return (
    <span className="ledger-verdict">
      <StatusBadge status={status} label={label} />
      {reason && (
        <span className="ledger-reason" title={reason}>
          {reason}
        </span>
      )}
    </span>
  );
}

const PAGE_SIZE = 5;

// The spends the payment executor decided (GET /api/spends/recent, treasurer only). A fresh event has none, and says so.
export function RecentSpends() {
  const event = useEvent();
  const feed = useFetch(
    withEvent(`/api/spends/recent?limit=${SPEND_RECENT_MAX}`, event),
    SpendsResponse,
  );
  const live =
    feed.kind === 'ready' ? feed.data.spends.filter((entry) => entry.amountMinor !== null) : [];
  // The newest spends come first; the table shows PAGE_SIZE at a time. A reload that shrinks the list clamps the page.
  const [requested, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(live.length / PAGE_SIZE));
  const page = Math.min(requested, pages - 1);
  const visible = live.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section className="card ledger" aria-labelledby="ledger-title">
      <div className="section-head">
        <h2 id="ledger-title">Recent spends</h2>
      </div>
      {feed.kind === 'loading' && (
        <p className="muted" role="status">
          Loading spends…
        </p>
      )}
      {feed.kind === 'error' && (
        <p className="muted">
          {errorMessage(feed.error).title}. {errorMessage(feed.error).detail}{' '}
          <Button variant="secondary" onClick={feed.reload}>
            Try again
          </Button>
        </p>
      )}
      {feed.kind === 'ready' && live.length === 0 && (
        <p className="muted">
          No spends yet. When the agent pays for something, the rules’ decision shows here.
        </p>
      )}
      {live.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th>Rules said</th>
                <th className="num">Amount</th>
                <th>PayPal ID</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td className="ledger-date num">{ledgerDate(entry.at)}</td>
                  <td>{entry.vendor ?? entry.category ?? 'Spend'}</td>
                  <td>
                    <Verdict
                      {...(outcomes[entry.status] ?? decisions[entry.decision])}
                      reason={entry.reasons[0]}
                    />
                  </td>
                  <td className="num">
                    {formatMoney(entry.amountMinor ?? 0, entry.currency ?? 'USD')}
                  </td>
                  <td>
                    {entry.paypalId ? (
                      <CopyId value={entry.paypalId} />
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
              {/* Blank rows keep a short last page as tall as a full one, so the card never shrinks. */}
              {Array.from({ length: PAGE_SIZE - visible.length }, (_, i) => (
                <tr key={`blank-${i}`} className="ledger-blank" aria-hidden="true">
                  <td colSpan={5} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {live.length > 0 && (
        <nav className="ledger-pager" aria-label="Recent spends pages">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="muted num" aria-live="polite">
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </section>
  );
}
