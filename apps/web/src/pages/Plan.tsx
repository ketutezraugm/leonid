import { PlanResponse, SponsorsResponse } from '@leonid/shared';
import { useEffect, useMemo } from 'react';
import { PlanCalendarPanel } from '../home/PlanCalendarPanel';
import { toPlanEvents } from '../home/planEvents';
import type { PlanSponsor } from '../plan/gating';
import { useFetch } from '../shell/api';
import { useEvent, withEvent } from '../shell/event';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';
import { StatusBadge } from '../ui/StatusBadge';

// While an invoice is unpaid, sponsor status is read again this often, so a payment shows without a reload.
const POLL_MS = 10_000;

// The event's own plan from GET /api/events/:id/plan (the tasks table), so each event has its plan. Sponsor status is
// live from GET /api/sponsors: INVOICING.INVOICE.PAID turns a sponsor's invoice task done and marks the purchases it
// funds as paid for. Nothing waits on a sponsor (the gate was removed Nov 6).
export function Plan() {
  const event = useEvent();
  const plan = useFetch(`/api/events/${encodeURIComponent(event.id ?? 'demo')}/plan`, PlanResponse);
  const feed = useFetch(withEvent('/api/sponsors', event), SponsorsResponse);

  const sponsors: PlanSponsor[] = useMemo(
    () =>
      feed.kind === 'ready'
        ? feed.data.sponsors.map(({ id, name, status }) => ({ id, name, status }))
        : [],
    [feed],
  );
  // The same events Home's calendar gets, so the two always show the same plan.
  const events = useMemo(
    () => (plan.kind === 'ready' ? toPlanEvents(plan.data, new Date(), sponsors) : []),
    [plan, sponsors],
  );
  const unpaid = sponsors.some((sponsor) => sponsor.status !== 'paid');

  const { refresh } = feed;
  const polling = feed.kind === 'ready' && unpaid;
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
      {plan.kind === 'loading' && <PageState kind="loading" title="Loading the plan…" />}
      {plan.kind === 'error' && (
        <PageState kind="error" title="Could not load the plan" onRetry={plan.reload}>
          {plan.error.message}
        </PageState>
      )}
      {plan.kind === 'ready' && events.length === 0 && (
        <PageState kind="empty" title="No plan for this event yet">
          Ask the agent to plan it, and its tasks will appear here.
        </PageState>
      )}
      {plan.kind === 'ready' && events.length > 0 && (
        <>
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
                Sponsor payments are live from PayPal.
              </p>
            </div>
          </Card>
          <PlanCalendarPanel events={events} eventDate={plan.data.eventDate} />
        </>
      )}
    </section>
  );
}
