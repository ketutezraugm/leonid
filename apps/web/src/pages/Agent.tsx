import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useChatEvent } from '../shell/event';
import { PageState } from '../ui/PageState';

// The workspace carries P1's chat (AI SDK), so it loads only when this page opens.
const Workspace = lazy(() => import('../workspace/Workspace').then((m) => ({ default: m.Workspace })));

export function Agent() {
  const chatEvent = useChatEvent();
  const location = useLocation();
  const navigate = useNavigate();
  // New event hands over { planEvent: true }. Read once, then cleared from history so a reload does not plan again.
  const [autoPlan] = useState(() => (location.state as { planEvent?: boolean } | null)?.planEvent === true);
  useEffect(() => {
    if (location.state) navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location, navigate]);
  return (
    <Suspense fallback={<PageState kind="loading" title="Loading the agent…" />}>
      <Workspace {...chatEvent} autoPlan={autoPlan} />
    </Suspense>
  );
}
