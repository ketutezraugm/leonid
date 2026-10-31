import { NavLink } from 'react-router-dom';
import { BrandMark } from '../ui/BrandMark';
import { Icon, type IconName } from '../ui/icons';
import { useShellData } from './data';
import { eventPath, useCurrentEvent } from './event';
import { EventSwitcher } from './EventSwitcher';
import { useSession } from './session';
import { walletLabel } from './wallet';

// The screens of one event, in the order of the event's life. Paths are relative to /events/:eventId/.
const nav: { screen: string; label: string; icon: IconName }[] = [
  { screen: '', label: 'Event home', icon: 'home' },
  { screen: 'agent', label: 'Agent', icon: 'agent' },
  { screen: 'plan', label: 'Plan', icon: 'plan' },
  { screen: 'money', label: 'Money', icon: 'money' },
  { screen: 'approvals', label: 'Approvals', icon: 'approvals' },
  { screen: 'rules', label: 'Rules', icon: 'rules' },
  { screen: 'claims', label: 'Claims', icon: 'claims' },
];

export function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { session, signOut } = useSession();
  const { wallet, waiting } = useShellData();
  const event = useCurrentEvent();

  return (
    <aside className="shell-side">
      <div className="shell-top">
        <span className="brand">
          <BrandMark />
          <span className="shell-label">Quartermaster</span>
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
          <EventSwitcher current={event} />
          <nav className="shell-nav" aria-label="Main">
            {nav.map((item) => (
              <NavLink
                key={item.screen || 'home'}
                to={eventPath(event.routeId, item.screen)}
                end={item.screen === ''}
                title={item.label}
              >
                <Icon name={item.icon} />
                <span className="shell-label">{item.label}</span>
                {item.screen === 'approvals' && waiting > 0 && (
                  <span className="nav-count" aria-label={`${waiting} waiting`}>
                    {waiting}
                  </span>
                )}
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
        </nav>
      )}

      <div className="shell-foot">
        {event && (
          <NavLink to="/events" end title="All events">
            <Icon name="events" />
            <span className="shell-label">All events</span>
          </NavLink>
        )}
        <NavLink to="/settings" title="Settings">
          <Icon name="settings" />
          <span className="shell-label">Settings</span>
        </NavLink>
        {wallet.kind === 'ready' && (
          <NavLink to="/settings" className={`wallet-status wallet-status--${wallet.data.status} shell-label`}>
            {walletLabel(wallet.data.status)}
          </NavLink>
        )}
        {session.status === 'signed-in' && (
          <button type="button" className="shell-signout shell-label" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}
