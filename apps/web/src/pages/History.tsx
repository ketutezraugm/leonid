import { PlanHistory } from '../home/PlanHistory';
import { PageHeader } from '../ui/PageHeader';

// History: every venue plan across the organizer's events, paid and still to pay.
export function History() {
  return (
    <section className="history">
      <PageHeader
        title="History"
        description="Plans still to pay and plans already paid. Open one to see what was paid."
      />
      <PlanHistory />
    </section>
  );
}
