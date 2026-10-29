import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// Public and shared outside the team, at an unguessable link (/report/:shareToken). It names categories and
// vendors, never volunteers. The report endpoint is P3's (F22); until it exists the page says so.
export function SponsorReport() {
  return (
    <section>
      <PageHeader title="Sponsor report" description="Where your sponsorship went, line by line." />
      <PageState kind="empty" title="This report isn't ready yet">
        Once the event has spent your sponsorship, the totals by category and each purchase with its PayPal ID will
        appear here.
      </PageState>
    </section>
  );
}
