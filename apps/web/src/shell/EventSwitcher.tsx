import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { countdown, eventPath, formatEventDate, useEvents, type EventInfo } from './event';

// The sidebar's event block, as a button: it opens every event (the current one checked), then All events and
// New event. Choosing an event keeps the same screen (Plan stays Plan) and changes only the event in the URL.
export function EventSwitcher({ current }: { current: EventInfo }) {
  const { events } = useEvents();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const screen = pathname.replace(/^\/events\/[^/]+\/?/, '');

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
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % links.length : (at - 1 + links.length) % links.length;
    event.preventDefault();
    links[next]?.focus();
  }

  const close = () => setOpen(false);

  return (
    <div className="event-switch" ref={root}>
      <button
        ref={button}
        type="button"
        className="event-switch-button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${current.name}, ${countdown(current.date)}. Switch event`}
        title={current.name}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="event-initial" aria-hidden="true">
          {current.name.charAt(0)}
        </span>
        <span className="event-switch-text shell-label">
          <strong>{current.name}</strong>
          <span className="muted">
            {formatEventDate(current.date)} · {countdown(current.date)}
          </span>
        </span>
        <svg className="event-switch-chevron shell-label" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div id={menuId} ref={menu} className="event-menu" onKeyDown={onMenuKey}>
          <p className="event-menu-title">Switch event</p>
          <ul>
            {events.map((e) => (
              <li key={e.routeId}>
                <Link
                  to={eventPath(e.routeId, screen)}
                  aria-current={e.routeId === current.routeId ? 'true' : undefined}
                  onClick={close}
                >
                  <span className="event-menu-name">{e.name}</span>
                  <span className="muted">
                    {formatEventDate(e.date)} · {countdown(e.date)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="event-menu-foot">
            <Link to="/events" onClick={close}>
              All events
            </Link>
            <Link to="/setup" onClick={close}>
              New event
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
