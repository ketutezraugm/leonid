import { TreasuryStatus } from '../setup/TreasuryStatus';
import { useSession } from '../shell/session';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';

export function Profile() {
  const { session, signOut } = useSession();
  const signedIn = session.status === 'signed-in';

  return (
    <section>
      <PageHeader title="Profile" description="Who is signed in, and the PayPal account the agent pays from." />

      <Card title="Account">
        {signedIn ? (
          <>
            <p>
              {session.email ? (
                <>
                  Signed in as <strong>{session.email}</strong>.
                </>
              ) : (
                <>
                  Signed in as a <strong>demo organizer</strong>.
                </>
              )}
            </p>
            <p className="muted">
              {session.via === 'paypal' ? 'You signed in with PayPal.' : 'This is a demo session, not a PayPal login.'}
            </p>
            <div className="btn-row">
              <Button variant="secondary" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </>
        ) : (
          <p className="muted">You are not signed in.</p>
        )}
      </Card>

      <Card title="PayPal balance">
        <TreasuryStatus />
      </Card>
    </section>
  );
}
