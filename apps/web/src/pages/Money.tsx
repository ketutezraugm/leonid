import { lazy, Suspense } from 'react';

// AG Studio is a large bundle, so it loads only when the Money page opens.
const CommandCenter = lazy(() => import('../money/CommandCenter'));

export function Money() {
  return (
    <section>
      <h1>Money</h1>
      <p className="muted">
        Sample data for now: the widgets switch to the live ledger endpoints once webhooks land.
      </p>
      <Suspense fallback={<p className="muted">Loading the command center…</p>}>
        <CommandCenter />
      </Suspense>
    </section>
  );
}
