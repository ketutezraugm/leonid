import { Link } from 'react-router-dom';
import { LANDING } from '../brand';
import { useSession } from '../shell/session';
import { Button } from '../ui/Button';
import { useEnterDemo } from './useEnterDemo';
import {
  BuiltWith,
  Closing,
  Credibility,
  Faq,
  Features,
  HeroVisual,
  HowItWorks,
  InOneView,
  LandingFooter,
  PaysPeople,
  TryIt,
  Wordmark,
} from './sections';

// The front door for signed-out visitors (it is what /signin shows). Judges and organisers land here first, so
// it says what the product is, gets a judge into the demo in one click, and sends them to its strongest
// moments. The hero is the brand slot: HeroVisual, the headline's accent words and the mark are where a new
// name and brand change the page; everything below it follows the product.
export function Landing({ problem }: { problem: string | null }) {
  const { session } = useSession();
  const { enter, busy, error } = useEnterDemo();
  const signedIn = session.status === 'signed-in';
  const message = error ?? problem;

  return (
    <div className="landing">
      <main>
        <section className="lp-hero" aria-labelledby="lp-title">
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
                <h1 id="lp-title">
                  Your event’s money, kept <span>by your rules</span>.
                </h1>
                <p className="lp-lede">
                  An AI agent that runs a community event’s money on PayPal: it invoices sponsors, buys what the plan
                  needs and pays people back, and it only spends what has cleared, within the rules you set.
                </p>
                {message && (
                  <p className="lp-problem" role="alert">
                    {message}
                  </p>
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
              <HeroVisual />
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
