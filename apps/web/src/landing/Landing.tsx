import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { LANDING } from '../brand';
import { useSession } from '../shell/session';
import { Button } from '../ui/Button';
import { useEnterDemo } from './useEnterDemo';
import { useTiltCards } from './useTilt';
import {
  BuiltWith,
  Closing,
  Credibility,
  Faq,
  Features,
  HeroLeo,
  HeroTitle,
  HowItWorks,
  InOneView,
  LandingFooter,
  Meteors,
  PaysPeople,
  TryIt,
  Wordmark,
} from './sections';

// The front door for signed-out visitors (it is what /signin shows). Judges and organisers land here first, so
// it says what the product is, gets a judge into the demo in one click, and sends them to its strongest
// moments. The hero is the brand slot: Leo, the headline's accent words and the mark are where the brand shows;
// everything below it follows the product.
export function Landing({ problem }: { problem: string | null }) {
  const { session } = useSession();
  const { enter, busy, error, code, setCode } = useEnterDemo();
  const signedIn = session.status === 'signed-in';
  const message = error ?? problem;
  const root = useRef<HTMLDivElement>(null);
  useTiltCards(root);

  return (
    <div ref={root} className="landing">
      <main>
        <section className="lp-hero" aria-labelledby="lp-title">
          <Meteors set="hero" />
          <div className="lp-wrap">
            <header className="lp-top">
              <Wordmark />
              <nav className="lp-nav" aria-label="Page">
                <a href="#how">How it works</a>
                <a href="#try">Try the demo</a>
                <a href="#faq">FAQ</a>
                {signedIn ? (
                  <Link className="btn lp-btn-ghost" to="/events">
                    Open your events
                  </Link>
                ) : (
                  <a className="btn lp-btn-ghost" href="/api/auth/paypal/login">
                    Log in
                  </a>
                )}
              </nav>
            </header>

            <div className="lp-hero-body">
              <div>
                <HeroTitle lead="Your event’s money, kept" accent="by your rules" end="." />
                <p className="lp-lede">
                  An AI agent that runs a community event’s money on PayPal: it invoices sponsors, buys what the plan
                  needs and pays people back, all inside the rules you set.
                </p>
                {message && (
                  <p className="lp-problem" role="alert">
                    {message}
                  </p>
                )}
                {!signedIn && (
                  <div className="lp-code">
                    <label htmlFor="lp-code">Judge access code</label>
                    <input
                      id="lp-code"
                      type="password"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="From the submission notes"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void enter();
                      }}
                    />
                  </div>
                )}
                <div className="lp-ctas">
                  {signedIn ? (
                    <Link className="btn lp-btn-light lp-btn-lg" to="/events">
                      Open your events
                    </Link>
                  ) : (
                    <>
                      <Button className="lp-btn-light lp-btn-lg" busy={busy} busyLabel="Signing in…" onClick={() => void enter()}>
                        Enter the demo
                      </Button>
                      <a className="btn lp-btn-ghost lp-btn-lg" href="/api/auth/paypal/login">
                        Log in with PayPal
                      </a>
                    </>
                  )}
                </div>
                <p className="lp-fine">Runs on the PayPal sandbox. No real money moves.</p>
              </div>
              <HeroLeo />
            </div>
          </div>
        </section>

        <BuiltWith />
        <InOneView />
        <Features />
        {LANDING.showPayouts && <PaysPeople />}
        <TryIt busy={busy} signedIn={signedIn} onTry={(to) => void enter(to)} />
        <HowItWorks />
        <Credibility />
        <Faq />
        <Closing busy={busy} signedIn={signedIn} onEnter={() => void enter()} />
      </main>
      <LandingFooter />
    </div>
  );
}
