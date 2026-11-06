import { lazy, Suspense } from 'react';
import { useCurrentEvent } from '../shell/event';
import { PageState } from '../ui/PageState';

// The workspace carries P1's chat (AI SDK), so it loads only when this page opens.
const Workspace = lazy(() => import('../workspace/Workspace').then((m) => ({ default: m.Workspace })));

export function Agent() {
  const event = useCurrentEvent();
  return (
    <Suspense fallback={<PageState kind="loading" title="Loading the agent…" />}>
      <Workspace inEvent={event} />
    </Suspense>
  );
}
