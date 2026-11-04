import { lazy, Suspense, useState } from 'react';
import { demoSponsors } from '../plan/demoPlan';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';

const PlanGantt = lazy(() => import('../plan/PlanGantt'));

// Sample plan until the plan endpoint exists (F11). The preview button shows what happens when PayPal reports
// a sponsor's invoice paid: the purchases it funds unblock. Live, that comes from INVOICING.INVOICE.PAID.
export function Plan() {
  const [sponsors, setSponsors] = useState(demoSponsors);
  const waiting = sponsors.filter((sponsor) => sponsor.status !== 'paid');
  const key = sponsors.map((sponsor) => sponsor.status).join();

  function markPaid(id: string) {
    setSponsors((current) => current.map((sponsor) => (sponsor.id === id ? { ...sponsor, status: 'paid' } : sponsor)));
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
          <div className="plan-preview">
            <span className="sample-tag">Sample</span>
            {waiting.length > 0 ? (
              waiting.map((sponsor) => (
                <button key={sponsor.id} type="button" className="btn btn-secondary" onClick={() => markPaid(sponsor.id)}>
                  Preview: {sponsor.name} pays
                </button>
              ))
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setSponsors(demoSponsors)}>
                Reset preview
              </button>
            )}
          </div>
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
