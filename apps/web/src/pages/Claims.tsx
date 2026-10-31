import { claimStatusView } from '../ui/claimStatus';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';
import { StatusBadge } from '../ui/StatusBadge';

// Volunteers read this on a phone: 16px type, 44px controls (see components.css). The claim list and the
// new-claim flow need P3's claims endpoints; until then the screen says so and shows what each state means.
export function Claims() {
  return (
    <section>
      <PageHeader title="Claims" description="Snap a receipt and see when you'll be paid back." />
      <PageState kind="empty" title="No claims yet">
        New claims, receipt upload and your status will appear here once the claims endpoints land (P3).
      </PageState>
      <section className="card" aria-label="What each status means">
        <h2 className="card-title">What each status means</h2>
        <ul className="status-legend">
          {(Object.keys(claimStatusView) as (keyof typeof claimStatusView)[]).map((key) => (
            <li key={key}>
              <StatusBadge status={claimStatusView[key].status} label={claimStatusView[key].label} />
            </li>
          ))}
        </ul>
        <p className="muted">PayPal is the default payout. Venmo is only offered once its sandbox test passes.</p>
      </section>
    </section>
  );
}
