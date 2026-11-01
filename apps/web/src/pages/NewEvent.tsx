import { Link } from 'react-router-dom';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// New event is the setup flow (UX plan 1, screen 2): the event, the treasury, the agent wallet. It needs
// POST /api/events (P1); until then this says so instead of offering a form that cannot save.
export function NewEvent() {
  return (
    <section>
      <PageHeader title="New event" description="Name, date, headcount and budget, then the agent sets up the rest." />
      <PageState kind="empty" title="Event setup is on its way">
        Creating an event needs the events endpoint, which is being built. Until then you can open the demo event
        from <Link to="/events">All events</Link>.
      </PageState>
    </section>
  );
}
