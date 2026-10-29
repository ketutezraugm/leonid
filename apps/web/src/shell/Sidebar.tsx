import { NavLink } from 'react-router-dom';
import { ApprovalsResponse } from '@quartermaster/shared';
import { BrandMark } from '../ui/BrandMark';
import { Icon, type IconName } from '../ui/icons';
import { useFetch } from './api';
import { daysUntil, EVENT, formatEventDate } from './event';
import { useSession } from './session';
import { parseWallet, walletLabel } from './wallet';

const nav: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Event home', icon: 'home' },
  { to: '/plan', label: 'Plan', icon: 'plan' },
  { to: '/money', label: 'Money', icon: 'money' },
  { to: '/approvals', label: 'Approvals', icon: 'approvals' },
  { to: '/rules', label: 'Rules', icon: 'rules' },
  { to: '/claims', label: 'Claims', icon: 'claims' },
];

export function Sidebar() {
  const { session, signOut } = useSession();
  const approvals = useFetch('/api/approvals', ApprovalsResponse);
  const wallet = useFetch('/api/wallet', parseWallet);

  const waiting = approvals.kind === 'ready' ? approvals.data.approvals.filter((a) => a.status === 'pending').length : 0;
  const days = daysUntil(EVENT.date);

  return (
    <aside className="shell-side">
      <span className="brand">
        <BrandMark />
        <span className="shell-label">Quartermaster</span>
      </span>
      <div className="shell-event shell-label">
        <strong>{EVENT.name}</strong>
        <span className="muted">
          {formatEventDate(EVENT.date)} · {days >= 0 ? `${days} days to go` : 'Event over'}
        </span>
      </div>
      <nav className="shell-nav" aria-label="Main">
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} title={item.label}>
            <Icon name={item.icon} />
            <span className="shell-label">{item.label}</span>
            {item.to === '/approvals' && waiting > 0 && (
              <span className="nav-count" aria-label={`${waiting} waiting`}>
                {waiting}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="shell-foot">
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
