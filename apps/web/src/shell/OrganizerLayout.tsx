import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AgentButton } from '../ui/AgentButton';
import { Drawer } from '../ui/Drawer';
import { useToast } from '../ui/Toast';
import { Sidebar } from './Sidebar';

// P1's chat is large (AI SDK), so it loads the first time the drawer opens, then stays mounted.
const AgentChat = lazy(() => import('../chat/AgentChat').then((m) => ({ default: m.AgentChat })));

// Plan and Money give the Gantt and AG Studio the full width: the sidebar collapses to an icon rail.
const RAIL_ROUTES = ['/plan', '/money'];

// PayPal sends the browser back to /?wallet=… and /?login=… (return paths to confirm with P2).
const returnMessages: Record<string, { kind: 'success' | 'error'; text: string }> = {
  'wallet=connected': { kind: 'success', text: 'Wallet connected. The agent can pay carts within your rules.' },
  'wallet=error': { kind: 'error', text: "PayPal didn't connect the wallet. Try again." },
  'wallet=cancelled': { kind: 'error', text: 'Wallet connection cancelled. The agent still can’t buy anything.' },
  'login=ok': { kind: 'success', text: 'Signed in.' },
  'login=error': { kind: 'error', text: "PayPal didn't sign you in. Try again." },
};

export function OrganizerLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const rail = RAIL_ROUTES.includes(pathname);

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setEverOpened(true);
    else button.current?.focus();
  }, []);

  // "/" opens the agent from anywhere except while typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggle(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

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
    setParams(clean, { replace: true });
  }, [params, setParams, navigate, toast]);

  return (
    <div className={`shell${rail ? ' shell--rail' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar />
      <main id="main" className="shell-sheet" tabIndex={-1}>
        <Outlet />
      </main>
      <Drawer id="agent-drawer" open={open} title="Ask the agent" onClose={() => toggle(false)}>
        {everOpened && (
          <Suspense fallback={<p className="muted drawer-loading">Loading the agent…</p>}>
            <AgentChat />
          </Suspense>
        )}
      </Drawer>
      <AgentButton ref={button} open={open} controls="agent-drawer" onClick={() => toggle(!open)} />
    </div>
  );
}
