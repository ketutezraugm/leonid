import { lazy, Suspense } from 'react';
import { PageHeader } from '../ui/PageHeader';

// AG Studio is a large bundle, so it loads only when the Money page opens.
const CommandCenter = lazy(() => import('../money/CommandCenter'));

export function Money() {
  return (
    <section>
      <PageHeader
        title="Money"
        description="Sample data for now: the widgets switch to the live ledger endpoints once webhooks land."
      />
      <Suspense fallback={<p className="muted">Loading the command center…</p>}>
        <CommandCenter />
      </Suspense>
    </section>
  );
}
