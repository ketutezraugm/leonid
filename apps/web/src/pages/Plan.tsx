import { lazy, Suspense } from 'react';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';

const PlanGantt = lazy(() => import('../plan/PlanGantt'));

export function Plan() {
  return (
    <section>
      <PageHeader
        title="Plan"
        description="Tasks, purchases and the sponsor payments they depend on, counting down to event day."
      />
      <Card>
        <div className="badge-row">
          <StatusBadge status="done" />
          <StatusBadge status="progress" />
          <StatusBadge status="pending" />
          <StatusBadge status="risk" label="Late delivery" />
          <StatusBadge status="blocked" label="Waiting on sponsor payment" />
        </div>
      </Card>
      <Card>
        <Suspense fallback={<p className="muted">Loading plan…</p>}>
          <PlanGantt />
        </Suspense>
      </Card>
    </section>
  );
}
