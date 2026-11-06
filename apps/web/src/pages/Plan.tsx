import { lazy, Suspense } from 'react';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';
import { EventTasks } from '../plan/EventTasks';
import { useEvent } from '../shell/event';

const PlanGantt = lazy(() => import('../plan/PlanGantt'));

export function Plan() {
  const event = useEvent();
  // The Gantt below is the seeded demo's plan. Another event gets its own tasks, not the demo's.
  if (event.id !== null) {
    return (
      <section>
        <PageHeader title="Plan" description="The tasks planned for this event, counting down to event day." />
        <EventTasks eventId={event.id} />
      </section>
    );
  }
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
      {/* The Gantt draws its own frame; a Card around it would double the border. */}
      <div className="plan-gantt">
        <Suspense fallback={<p className="muted">Loading plan…</p>}>
          <PlanGantt />
        </Suspense>
      </div>
    </section>
  );
}
