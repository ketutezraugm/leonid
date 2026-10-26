import { NavLink, Route, Routes } from 'react-router-dom';
import { Approvals } from './pages/Approvals';
import { Claims } from './pages/Claims';
import { EventHome } from './pages/EventHome';
import { Money } from './pages/Money';
import { Plan } from './pages/Plan';
import { Rules } from './pages/Rules';
import { SponsorReport } from './pages/SponsorReport';

const nav = [
  { to: '/', label: 'Event home' },
  { to: '/plan', label: 'Plan' },
  { to: '/money', label: 'Money' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/rules', label: 'Rules' },
  { to: '/claims', label: 'Claims' },
];

export function App() {
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="brand">Quartermaster</span>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="shell-main">
        <Routes>
          <Route path="/" element={<EventHome />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/money" element={<Money />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/claims" element={<Claims />} />
          <Route path="/report/:sponsorId" element={<SponsorReport />} />
        </Routes>
      </main>
    </div>
  );
}
