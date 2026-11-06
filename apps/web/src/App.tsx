import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Agent } from './pages/Agent';
import { Approvals } from './pages/Approvals';
import { Checkout } from './pages/Checkout';
import { Claims } from './pages/Claims';
import { VolunteerClaim } from './pages/VolunteerClaim';
import { EventHome } from './pages/EventHome';
import { Events } from './pages/Events';
import { Money } from './pages/Money';
import { NewEvent } from './pages/NewEvent';
import { NotFound } from './pages/NotFound';
import { Plan } from './pages/Plan';
import { Rules } from './pages/Rules';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { SponsorReport } from './pages/SponsorReport';
import { eventPath, EventsProvider, useEvent } from './shell/event';
import { EventScope } from './shell/EventScope';
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

// "/" is All events. The query rides along, so a PayPal return (?wallet=…, ?login=…) still shows its message.
function ToAllEvents() {
  const { search } = useLocation();
  return <Navigate to={`/events${search}`} replace />;
}

// Links from before events had their own URLs (/plan, /agent …) open that screen in the last-opened event.
function ToEventScreen({ screen }: { screen: string }) {
  const { search } = useLocation();
  const { routeId } = useEvent();
  return <Navigate to={`${eventPath(routeId, screen)}${search}`} replace />;
}

const SCREENS = ['agent', 'plan', 'money', 'approvals', 'rules', 'claims'] as const;

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <EventsProvider>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route element={<OrganizerLayout />}>
              <Route path="/" element={<ToAllEvents />} />
              <Route path="/events" element={<Events />} />
              <Route path="/setup" element={<NewEvent />} />
              <Route path="/events/:eventId" element={<EventScope />}>
                <Route index element={<EventHome />} />
                <Route path="agent" element={<Agent />} />
                <Route path="plan" element={<Plan />} />
                <Route path="money" element={<Money />} />
                <Route path="approvals" element={<Approvals />} />
                <Route path="rules" element={<Rules />} />
                <Route path="claims" element={<Claims />} />
                <Route path="*" element={<NotFound />} />
              </Route>
              {SCREENS.map((screen) => (
                <Route key={screen} path={`/${screen}`} element={<ToEventScreen screen={screen} />} />
              ))}
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route
              path="/e/:eventId"
              element={
                <PublicLayout>
                  <Checkout />
                </PublicLayout>
              }
            />
            <Route
              path="/claim/:token"
              element={
                <PublicLayout>
                  <VolunteerClaim />
                </PublicLayout>
              }
            />
            <Route
              path="/report/:shareToken"
              element={
                <PublicLayout>
                  <SponsorReport />
                </PublicLayout>
              }
            />
          </Routes>
        </EventsProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
