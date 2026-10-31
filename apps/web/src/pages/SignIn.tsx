import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiFailure, sendJson } from '../shell/api';
import { BrandMark } from '../ui/BrandMark';
import { Button } from '../ui/Button';

const parseOk = { parse: (value: unknown) => value };

const loginProblems: Record<string, string> = {
  error: "PayPal didn't sign you in. Try again.",
  denied: "Your PayPal account isn't allowed to use this event. Ask the treasurer to add you.",
};

// Sign in is a full-page redirect to PayPal and back (never a popup). Only allowlisted PayPal accounts
// get in; "Enter demo as treasurer" is for judges and the video, and only works where the server enables it.
export function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(loginProblems[params.get('login') ?? ''] ?? null);

  async function demo() {
    setBusy(true);
    setProblem(null);
    try {
      await sendJson('/api/auth/demo-login', parseOk);
      navigate('/', { replace: true });
      // The session context reads /me once on load, so a full reload picks up the new cookie.
      window.location.reload();
    } catch (err) {
      setBusy(false);
      setProblem(
        err instanceof ApiFailure && err.status === 404
          ? "Demo sign-in isn't turned on for this server."
          : "Couldn't sign in. Try again.",
      );
    }
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <span className="brand">
          <BrandMark />
          Quartermaster
        </span>
        <h1>Run your event’s money without the spreadsheet</h1>
        <p className="muted">
          Sponsor money comes in, purchases and payouts go out, and every payment passes the spending rules you set.
        </p>
        {problem && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
        <div className="btn-row signin-actions">
          <a className="btn btn-primary" href="/api/auth/paypal/login">
            Log in with PayPal
          </a>
          <Button busy={busy} busyLabel="Signing in…" onClick={() => void demo()}>
            Enter demo as treasurer
          </Button>
        </div>
        <p className="muted signin-note">This is a PayPal sandbox. No real money moves.</p>
      </div>
    </main>
  );
}
