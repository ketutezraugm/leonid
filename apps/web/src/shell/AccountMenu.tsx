import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { paypalBalance } from '../home/budget';
import { Icon } from '../ui/icons';
import { formatMoney } from '../ui/money';
import { readBalanceHidden, saveBalanceHidden } from './balancePref';
import { useShellData } from './data';
import { countdown, eventPath, formatEventDate, useCurrentEvent, useEvents } from './event';
import { useSession } from './session';

const MASKED = '••••••';

// The sidebar's bottom-left account card: who is signed in and the PayPal balance (hideable). Opening it gives the
// account menu: Profile and Settings stay fixed at the top, the event list in the middle scrolls on its own, and
// All events, New event and Sign out stay fixed at the bottom. Choosing an event keeps the same screen.
export function AccountMenu() {
  const { session, signOut } = useSession();
  const { treasury } = useShellData();
  const { events } = useEvents();
  const current = useCurrentEvent();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(readBalanceHidden);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const screen = pathname.replace(/^\/events\/[^/]+\/?/, '');

  const signedIn = session.status === 'signed-in';
  const email = signedIn ? session.email : undefined;
  const name = email ?? (signedIn ? 'Demo organizer' : 'Organizer');
  const initial = name.charAt(0).toUpperCase();
  const via = signedIn ? (session.via === 'paypal' ? 'PayPal' : 'Demo') : null;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLAnchorElement>('[aria-current="true"], a')?.focus();
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Up and down move between the menu's links.
  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = Array.from(menu.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
    if (links.length === 0) return;
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % links.length : (at - 1 + links.length) % links.length;
    event.preventDefault();
    links[next]?.focus();
  }

  function toggleHidden() {
    setHidden((h) => {
      saveBalanceHidden(!h);
      return !h;
    });
  }

  let figure = '…';
  if (treasury.kind === 'error') figure = '—';
  if (treasury.kind === 'ready') {
    const balance = paypalBalance(treasury.data, current?.currency ?? 'USD') ?? treasury.data.balances[0];
    figure = balance ? formatMoney(balance.totalMinor, balance.currency) : '—';
  }

  const close = () => setOpen(false);

  return (
    <div className="account" ref={root}>
      <div className="account-card">
        <span className="account-initial" aria-hidden="true">
          {initial}
        </span>
        <span className="account-text shell-label">
          <strong>{name}</strong>
          <span className="account-balance">
            <span className="muted num">{hidden ? MASKED : figure}</span>
            <button
              type="button"
              className="account-eye"
              aria-pressed={hidden}
              aria-label={hidden ? 'Show balance' : 'Hide balance'}
              title={hidden ? 'Show balance' : 'Hide balance'}
              onClick={toggleHidden}
            >
              <Icon name={hidden ? 'eyeOff' : 'eye'} />
            </button>
          </span>
        </span>
        <button
          ref={button}
          type="button"
          className="account-button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Account, ${name}. Open menu`}
          title={name}
          onClick={() => setOpen((o) => !o)}
        />
      </div>

      {open && (
        <div id={menuId} ref={menu} className="account-menu" onKeyDown={onMenuKey}>
          <div className="account-menu-head">
            <span className="account-initial" aria-hidden="true">
              {initial}
            </span>
            <span className="account-text">
              <strong>{name}</strong>
              {via && <span className="muted">Signed in with {via}</span>}
            </span>
          </div>
          <div className="account-menu-links">
            <Link to="/profile" onClick={close}>
              <Icon name="user" />
              Profile
            </Link>
            <Link to="/settings" onClick={close}>
              <Icon name="settings" />
              Settings
            </Link>
          </div>

          <p className="account-menu-title">Events</p>
          <ul className="account-menu-events">
            {events.map((e) => (
              <li key={e.routeId}>
                <Link
                  to={eventPath(e.routeId, screen)}
                  aria-current={e.routeId === current?.routeId ? 'true' : undefined}
                  onClick={close}
                >
                  <span className="account-menu-event">
                    <span className="event-menu-name">{e.name}</span>
                    <span className="muted">
                      {formatEventDate(e.date)} · {countdown(e.date)}
                    </span>
                  </span>
                  {e.routeId === current?.routeId && <Icon name="check" />}
                </Link>
              </li>
            ))}
          </ul>

          <div className="account-menu-foot">
            <Link to="/events" onClick={close}>
              <Icon name="events" />
              All events
            </Link>
            <Link to="/setup" onClick={close}>
              <Icon name="plus" />
              New event
            </Link>
            {signedIn && (
              <button
                type="button"
                onClick={() => {
                  close();
                  void signOut();
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
