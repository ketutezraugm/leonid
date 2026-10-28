import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Approvals } from './pages/Approvals';
import { Claims } from './pages/Claims';
import { EventHome } from './pages/EventHome';
import { Money } from './pages/Money';
import { NotFound } from './pages/NotFound';
import { Plan } from './pages/Plan';
import { Rules } from './pages/Rules';
import { SponsorReport } from './pages/SponsorReport';
import { BrandMark } from './ui/BrandMark';

const nav = [
  { to: '/', label: 'Event home' },
  { to: '/plan', label: 'Plan' },
  { to: '/money', label: 'Money' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/rules', label: 'Rules' },
  { to: '/claims', label: 'Claims' },
];

function OrganizerLayout() {
  return (
    <div className="shell">
      <aside className="shell-side">
        <span className="brand">
          <BrandMark />
          Quartermaster
        </span>
        <nav className="shell-nav" aria-label="Main">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="shell-sheet">
        <Outlet />
      </main>
    </div>
  );
}

// Sponsor reports are shared outside the team, so they get no organizer navigation.
function PublicLayout() {
  return (
    <main className="public-main">
      <Outlet />
      <footer className="public-footer muted">
        Prepared by Quartermaster from PayPal records.
      </footer>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<OrganizerLayout />}>
        <Route path="/" element={<EventHome />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/money" element={<Money />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route element={<PublicLayout />}>
        <Route path="/report/:sponsorId" element={<SponsorReport />} />
      </Route>
    </Routes>
  );
}
