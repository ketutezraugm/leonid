import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AgentButton } from '../ui/AgentButton';
import { Drawer } from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import { ShellDataProvider } from './data';
import { useEventPath } from './event';
import { clearReturnPath, peekReturnPath } from './returnPath';
import { useSession } from './session';
import { Sidebar } from './Sidebar';
import { readSidebarOpen, saveSidebarOpen } from './sidebarPref';

// P1's chat is large (AI SDK), so it loads the first time the drawer opens, then stays mounted.
const AgentChat = lazy(() => import('../chat/AgentChat').then((m) => ({ default: m.AgentChat })));

// Plan, Money and Agent need the full width: the sidebar starts as an icon rail there and open elsewhere,
// until the person picks a state with its button.
const WIDE_SCREENS = ['plan', 'money', 'agent'];

// PayPal sends the browser back to /?wallet=… and /?login=… (return paths to confirm with P2).
const returnMessages: Record<string, { kind: 'success' | 'error'; text: string }> = {
  'wallet=connected': { kind: 'success', text: 'Wallet connected. The agent can pay carts within your rules.' },
  'wallet=error': { kind: 'error', text: "PayPal didn't connect the wallet. Try again." },
  'wallet=cancelled': { kind: 'error', text: 'Wallet connection cancelled. The agent still can’t buy anything.' },
  'login=ok': { kind: 'success', text: 'Signed in.' },
  'login=error': { kind: 'error', text: "PayPal didn't sign you in. Try again." },
};

export function OrganizerLayout() {
  const { pathname, search } = useLocation();
  const { session } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const button = useRef<HTMLButtonElement>(null);
  const path = useEventPath();
  // The screen inside the event: /events/:eventId/plan → "plan".
  const screen = pathname.match(/^\/events\/[^/]+\/([^/]+)/)?.[1] ?? '';
  const wide = WIDE_SCREENS.includes(screen);
  const rail = !(sidebarOpen ?? !wide);
  // The workspace has its own chat rail, so a second chat on the same thread would only fight it.
  const onAgent = screen === 'agent';

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setEverOpened(true);
    else button.current?.focus();
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(rail);
    saveSidebarOpen(rail);
  }, [rail]);

  const openWorkspace = useCallback(() => {
    toggle(false);
    navigate(path('agent'));
  }, [toggle, navigate, path]);

  // "/" opens the agent from anywhere except while typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (event.key === '/' && !onAgent && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggle(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle, onAgent]);

  // Turn a PayPal return (?wallet=…, ?login=…) into a toast, send a denied login to Sign in, then clean the URL.
  useEffect(() => {
    const login = params.get('login');
    if (login === 'denied') {
      navigate('/signin?login=denied', { replace: true });
      return;
    }
    const key = ['wallet', 'login'].map((name) => (params.get(name) ? `${name}=${params.get(name)}` : '')).find((k) => k in returnMessages);
    if (!key) return;
    const message = returnMessages[key]!;
    if (message.kind === 'success') toast.success(message.text);
    else toast.error(message.text);
    const clean = new URLSearchParams(params);
    clean.delete('wallet');
    clean.delete('login');
    const back = peekReturnPath();
    if (back) navigate(back, { replace: true });
    else setParams(clean, { replace: true });
  }, [params, setParams, navigate, toast]);

  useEffect(() => {
    if (onAgent) clearReturnPath();
  }, [onAgent]);

  // Keep the query: a denied or failed PayPal login still has its message to show on Sign in.
  if (session.status === 'signed-out') return <Navigate to={`/signin${search}`} replace />;

  return (
    <ShellDataProvider>
      <div className={`shell${rail ? ' shell--rail' : ''}${onAgent ? ' shell--agent' : ''}`}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Sidebar open={!rail} onToggle={toggleSidebar} />
        <main id="main" className="shell-sheet" tabIndex={-1}>
          <Outlet />
        </main>
        {!onAgent && (
          <>
            <Drawer id="agent-drawer" open={open} title="Ask the agent" onClose={() => toggle(false)}>
              {everOpened && (
                <Suspense fallback={<p className="muted drawer-loading">Loading the agent…</p>}>
                  {/* Venue results need the full-width canvas, so they open in the workspace. */}
                  <AgentChat onViewSearch={openWorkspace} viewLeavesChat />
                </Suspense>
              )}
            </Drawer>
            <AgentButton ref={button} open={open} controls="agent-drawer" onClick={() => toggle(!open)} />
          </>
        )}
      </div>
    </ShellDataProvider>
  );
}
