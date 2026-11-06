import { SponsorsResponse } from '@quartermaster/shared';
import { lazy, Suspense, useEffect } from 'react';
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
// sponsors match the plan's (the seeded demo event does): INVOICING.INVOICE.PAID turns a sponsor's invoice task
// done and marks the purchases it funds as paid for. Nothing waits on a sponsor (the gate was removed Nov 6).
export function Plan() {
  const event = useEvent();
  const feed = useFetch(withEvent('/api/sponsors', event), SponsorsResponse);
  const { sponsors, live } = planSponsors(
    demoSponsors,
    feed.kind === 'ready' ? feed.data.sponsors : null,
  );
  const unpaid = sponsors.some((sponsor) => sponsor.status !== 'paid');
  const key = sponsors.map((sponsor) => sponsor.status).join();

  const { refresh } = feed;
  const polling = live && unpaid;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  return (
    <section>
      <PageHeader
        title="Plan"
        description="Tasks and purchases, which sponsor funds each one, counting down to event day."
      />
      <Card>
        <div className="plan-legend">
          <div className="badge-row">
            <StatusBadge status="done" />
            <StatusBadge status="progress" />
            <StatusBadge status="pending" />
            <StatusBadge status="risk" label="At risk" />
            <StatusBadge status="blocked" label="Late" />
          </div>
          <p className="plan-preview muted" role="status">
            {live ? (
              <>
                <span className="sample-tag">Sample tasks</span> Sponsor payments are live from
                PayPal.
              </>
            ) : (
              <span className="sample-tag">Sample</span>
            )}
          </p>
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
