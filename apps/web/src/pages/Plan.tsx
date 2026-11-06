import { SponsorsResponse } from '@quartermaster/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { demoSponsors } from '../plan/demoPlan';
import { planSponsors } from '../plan/sponsorSource';
import { useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';

const PlanGantt = lazy(() => import('../plan/PlanGantt'));

// While an invoice is unpaid, sponsor status is read again this often, so a payment shows without a reload.
const POLL_MS = 10_000;

// Sample tasks until the plan endpoint exists (F11). Sponsor status is live from GET /api/sponsors when the event's
// sponsors match the plan's (the seeded demo event does), so INVOICING.INVOICE.PAID unblocks the purchases it funds.
// Without a match (signed out, no database, another event) the preview buttons show the same thing on sample data.
export function Plan() {
  const event = useEvent();
  const feed = useFetch(withEvent('/api/sponsors', event), SponsorsResponse);
  const { sponsors: fromFeed, live } = planSponsors(
    demoSponsors,
    feed.kind === 'ready' ? feed.data.sponsors : null,
  );
  const [preview, setPreview] = useState(demoSponsors);
  const sponsors = live ? fromFeed : preview;
  const waiting = sponsors.filter((sponsor) => sponsor.status !== 'paid');
  const key = sponsors.map((sponsor) => sponsor.status).join();

  const { refresh } = feed;
  const polling = live && waiting.length > 0;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  function markPaid(id: string) {
    setPreview((current) =>
      current.map((sponsor) => (sponsor.id === id ? { ...sponsor, status: 'paid' } : sponsor)),
    );
  }

  return (
    <section>
      <PageHeader
        title="Plan"
        description="Tasks, purchases and the sponsor payments they depend on, counting down to event day."
      />
      <Card>
        <div className="plan-legend">
          <div className="badge-row">
            <StatusBadge status="done" />
            <StatusBadge status="progress" />
            <StatusBadge status="pending" />
            <StatusBadge status="risk" label="Late delivery" />
            <StatusBadge status="blocked" label="Waiting on sponsor payment" />
          </div>
          {live ? (
            <p className="plan-preview muted" role="status">
              <span className="sample-tag">Sample tasks</span> Sponsor payments are live from PayPal
              {waiting.length > 0 ? ': a paid invoice unblocks its purchases here.' : '.'}
            </p>
          ) : (
            <div className="plan-preview">
              <span className="sample-tag">Sample</span>
              {waiting.length > 0 ? (
                waiting.map((sponsor) => (
                  <button
                    key={sponsor.id}
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => markPaid(sponsor.id)}
                  >
                    Preview: {sponsor.name} pays
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPreview(demoSponsors)}
                >
                  Reset preview
                </button>
              )}
            </div>
          )}
        </div>
      </Card>
      {/* The Gantt draws its own frame; a Card around it would double the border. */}
      <div className="plan-gantt">
        <Suspense fallback={<p className="muted">Loading plan…</p>}>
          <PlanGantt key={key} sponsors={sponsors} />
        </Suspense>
      </div>
    </section>
  );
}
