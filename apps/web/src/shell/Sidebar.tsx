import { NavLink, useLocation } from 'react-router-dom';
import { BRAND } from '../brand';
import { BrandMark } from '../ui/BrandMark';
import { Icon, type IconName } from '../ui/icons';
import { AccountMenu } from './AccountMenu';
import { countdown, eventPath, formatEventDate, useCurrentEvent, useEvent, useEvents } from './event';

// The screens of one event, in the order of the event's life. Paths are relative to /events/:eventId/.
const nav: { screen: string; label: string; icon: IconName }[] = [
  { screen: 'agent', label: 'Agent', icon: 'agent' },
  { screen: 'plan', label: 'Plan', icon: 'plan' },
  { screen: 'money', label: 'Money', icon: 'money' },
  { screen: 'claims', label: 'Claims', icon: 'claims' },
];

export function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const current = useCurrentEvent();
  const { pathname } = useLocation();
  const { events } = useEvents();
  const lastOpened = useEvent();
  // Settings and Profile belong to the account, not an event, but the sidebar keeps the last-opened event's
  // screens so opening them does not look like leaving for All events.
  const onAccountPage = pathname === '/settings' || pathname === '/profile';
  const event = current ?? (onAccountPage && events.some((e) => e.routeId === lastOpened.routeId) ? lastOpened : null);

  return (
    <aside className="shell-side">
      <div className="shell-top">
        <span className="brand">
          <BrandMark />
          <span className="shell-label">{BRAND.name}</span>
        </span>
        <button
          type="button"
          className="shell-toggle"
          aria-expanded={open}
          aria-label={open ? 'Close sidebar' : 'Open sidebar'}
          title={open ? 'Close sidebar' : 'Open sidebar'}
          onClick={onToggle}
        >
          <Icon name={open ? 'sidebarClose' : 'sidebarOpen'} />
        </button>
      </div>

      {event ? (
        <>
          <div className="event-label" title={event.name}>
            <span className="event-initial" aria-hidden="true">
              {event.name.charAt(0)}
            </span>
            <span className="event-label-text shell-label">
              <strong>{event.name}</strong>
              <span className="muted">
                {formatEventDate(event.date)} · {countdown(event.date)}
              </span>
            </span>
          </div>
          <nav className="shell-nav" aria-label="Main">
            {nav.map((item) => (
              <NavLink
                key={item.screen}
                to={eventPath(event.routeId, item.screen)}
                title={item.label}
              >
                <Icon name={item.icon} />
                <span className="shell-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </>
      ) : (
        <nav className="shell-nav" aria-label="Main">
          <NavLink to="/events" end title="All events">
            <Icon name="events" />
            <span className="shell-label">All events</span>
          </NavLink>
          <NavLink to="/history" title="History">
            <Icon name="history" />
            <span className="shell-label">History</span>
          </NavLink>
        </nav>
      )}

      <div className="shell-account">
        <AccountMenu />
      </div>
    </aside>
  );
}
