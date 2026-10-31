import { Route, Routes } from 'react-router-dom';
import { Agent } from './pages/Agent';
import { Approvals } from './pages/Approvals';
import { Claims } from './pages/Claims';
import { EventHome } from './pages/EventHome';
import { Money } from './pages/Money';
import { NotFound } from './pages/NotFound';
import { Plan } from './pages/Plan';
import { Rules } from './pages/Rules';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { SponsorReport } from './pages/SponsorReport';
import { OrganizerLayout } from './shell/OrganizerLayout';
import { SessionProvider } from './shell/session';
import { ToastProvider } from './ui/Toast';

// Sponsor reports are shared outside the team, so they get no organizer navigation.
function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="public-main">
      {children}
      <footer className="public-footer muted">Prepared by Quartermaster from PayPal records.</footer>
    </main>
  );
}

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route element={<OrganizerLayout />}>
            <Route path="/" element={<EventHome />} />
            <Route path="/agent" element={<Agent />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/money" element={<Money />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/claims" element={<Claims />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route
            path="/report/:shareToken"
            element={
              <PublicLayout>
                <SponsorReport />
              </PublicLayout>
            }
          />
        </Routes>
      </SessionProvider>
    </ToastProvider>
  );
}
