import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../ui/BrandMark';
import { BudgetBar, unlockedToSpend, type BudgetFigures } from '../ui/BudgetBar';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';
import { BRAND, LANDING, LINKS } from '../brand';
import { LeoMascot } from './LeoMascot';

// The demo event's figures, as the demo shows them (cleared $3,000 − committed $1,860 = $1,140 unlocked).
const DEMO_BUDGET: BudgetFigures = {
  currency: 'USD',
  cleared: 300_000,
  committed: 186_000,
  invoiced: 250_000,
  pledged: 250_000,
};

export function Wordmark() {
  return (
    <span className="lp-brand">
      <BrandMark />
      {BRAND.name}
    </span>
  );
}

// --- Hero: the one place the brand shows. The headline's letters lift on hover and a meteor swash draws itself
// under the accent words; Leo, the mascot, stands where the product proof used to be.
function Letters({ text }: { text: string }) {
  // Each word is one unbreakable box, so the per-letter spans never split a word across lines.
  return text.split(' ').map((word, w, words) => (
    <Fragment key={w}>
      <span className="lp-word">
        {Array.from(word).map((c, i) => (
          <span key={i} className="lp-ch">
            {c}
          </span>
        ))}
      </span>
      {w < words.length - 1 ? ' ' : null}
    </Fragment>
  ));
}

export function HeroTitle({ lead, accent, end }: { lead: string; accent: string; end: string }) {
  return (
    <h1 id="lp-title" aria-label={`${lead} ${accent}${end}`}>
      <span aria-hidden="true">
        <Letters text={lead} />{' '}
        <span className="lp-accent">
          <Letters text={accent} />
          <svg className="lp-swash" viewBox="0 0 255 72" preserveAspectRatio="none">
            <path pathLength={1} d="M6 44 C40 18 150 4 222 14 C262 20 258 48 214 58 C150 72 60 70 30 60 C10 53 20 40 60 34" />
          </svg>
        </span>
        <span className="lp-ch">{end}</span>
      </span>
    </h1>
  );
}

export function HeroLeo() {
  return (
    <div className="lp-leo-stage">
      <span className="lp-stamp" aria-hidden="true">
        Meet Leo
      </span>
      <LeoMascot className="lp-leo" />
    </div>
  );
}

// --- Built with: names only, never logos.
const BUILT_WITH = ['PayPal (Invoicing, Vault, Orders, Payouts)', 'Bryntum Gantt', 'AG Studio', 'Channel3', 'Render', 'APIMatic'];

export function BuiltWith() {
  return (
    <div className="lp-built">
      <div className="lp-wrap">
        <strong>Built with</strong>
        {BUILT_WITH.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
    </div>
  );
}

// --- In one view: a real screenshot of Event home.
export function InOneView() {
  return (
    <section className="lp-section lp-center" aria-labelledby="lp-view">
      <div className="lp-wrap">
        <h2 id="lp-view">Your event, planned and paid, in one view.</h2>
        <p className="lp-sub">The plan, the money and what needs you, side by side.</p>
        <img
          className="lp-shot"
          src="/landing/event-home.png"
          width={1440}
          height={900}
          alt="Event home: $1,140.00 unlocked to spend, a prize cart waiting for approval, recent spends and the plan"
          loading="lazy"
        />
      </div>
    </section>
  );
}

// --- Four feature rows: text beside a real piece of the product, alternating sides.
function Feature({ id, flip, title, text, points, children }: { id: string; flip?: boolean; title: string; text: string; points: string[]; children: ReactNode }) {
  return (
    <section className="lp-section" aria-labelledby={id}>
      <div className={`lp-wrap lp-feature${flip ? ' lp-feature--flip' : ''}`}>
        <div>
          <h2 id={id}>{title}</h2>
          <p className="lp-sub">{text}</p>
          <ul className="lp-points">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div className="lp-piece">{children}</div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <>
      <Feature
        id="lp-money"
        title="Only cleared money is spendable."
        text="Pledges and sent invoices are counted, never spent. The budget unlocks as sponsors actually pay."
        points={[
          'Sponsor invoices drafted by the agent, sent through PayPal',
          'Unlocked = cleared income minus what is committed',
          'Each event keeps its own budget',
        ]}
      >
        <p className="lp-piece-label">Unlocked to spend · OpenHack 2027</p>
        <p className="lp-piece-fig num">{formatMoney(unlockedToSpend(DEMO_BUDGET))}</p>
        <BudgetBar figures={DEMO_BUDGET} />
      </Feature>

      <Feature
        id="lp-rules"
        flip
        title="Set the rules once. It never crosses them."
        text="Write a rule the way you’d say it. It becomes a fixed rule in code, and the agent can’t argue its way around it."
        points={['Spending caps, approved vendors, claim limits', 'The strictest rule wins', 'Every check is logged']}
      >
        <p className="lp-piece-label">Rules</p>
        <div className="lp-rule">
          <span>“Nothing over $200 without my approval.”</span>
          <code>maxPerOrder: 20000 USD → needs_approval</code>
        </div>
        <div className="lp-rule">
          <span>“Volunteers can claim up to $50 a day.”</span>
          <code>claimCap: 5000 USD / person / day</code>
        </div>
      </Feature>

      <Feature
        id="lp-approve"
        title="A yes from you before anything big."
        text="Above your rules, the agent stops and asks. You see why it needs you and approve in PayPal."
        points={[
          'Why the rules sent it, in plain words',
          'The agent’s reasoning and the options it compared',
          'Approve with PayPal, or decline with a reason',
        ]}
      >
        <div className="lp-appr">
          <b>Prize cart</b>
          <span className="lp-piece-fig lp-piece-fig--sm num">{formatMoney(42_000)}</span>
        </div>
        <StatusBadge status="risk" label="Over your $200 rule" />
        <p className="lp-piece-label">Six prize bundles from the cheapest seller that delivers before judging.</p>
        <span className="lp-paypal" aria-hidden="true">
          Approve with PayPal
        </span>
      </Feature>

      <Feature
        id="lp-plan"
        flip
        title="The plan waits for the money."
        text="Purchases funded by a sponsor stay blocked on the plan until that sponsor pays. Late deliveries turn red before they become a problem."
        points={['A Gantt plan the agent builds from one sentence', 'Sponsor invoices gate the work they fund', 'Event day stays fixed']}
      >
        <p className="lp-piece-label">Plan</p>
        <div className="lp-gantt" role="img" aria-label="The swag order is blocked until the sponsor invoice is paid; event day is fixed">
          <div className="lp-grow">
            <span>Sponsor invoice</span>
            <span className="lp-track">
              <i className="lp-bar-progress" style={{ left: '4%', width: '30%' }} />
            </span>
          </div>
          <div className="lp-grow">
            <span>Order swag</span>
            <span className="lp-track">
              <i className="lp-bar-blocked" style={{ left: '36%', width: '22%' }} />
            </span>
          </div>
          <div className="lp-grow">
            <span>Swag delivery</span>
            <span className="lp-track">
              <i className="lp-bar-pending" style={{ left: '60%', width: '30%' }} />
            </span>
          </div>
          <div className="lp-grow">
            <span>Event day</span>
            <span className="lp-track">
              <i className="lp-bar-event" style={{ left: '94%', width: '2px' }} />
            </span>
          </div>
        </div>
        <p className="lp-piece-label">Swag waits for the sponsor’s invoice. Plan drawn with Bryntum Gantt.</p>
      </Feature>
    </>
  );
}

// --- Pays people back (F16, F17: Upgrade tier). Switch off in brand.ts if it does not ship.
const PAYOUTS: { title: string; text: string; phone: ReactNode }[] = [
  {
    title: 'Snap a receipt',
    text: 'The fields are read for you; the rule check shows before you submit.',
    phone: (
      <>
        <p className="lp-piece-label">New claim</p>
        <p className="lp-phone-line">
          <b>Snacks</b> <span className="num">{formatMoney(4_250)}</span>
        </p>
        <StatusBadge status="done" label="Within your $50 a day" />
        <span className="lp-phone-btn">Submit claim</span>
      </>
    ),
  },
  {
    title: 'Prize payouts in one batch',
    text: 'Winners in different countries are paid together, with a status per item.',
    phone: (
      <>
        <p className="lp-piece-label">Prize payouts · 3 winners</p>
        <p className="lp-phone-line"><b>First prize</b> <StatusBadge status="done" label="Paid" /></p>
        <p className="lp-phone-line"><b>Second prize</b> <StatusBadge status="progress" label="Sending" /></p>
        <p className="lp-phone-line"><b>Third prize</b> <StatusBadge status="pending" label="Queued" /></p>
      </>
    ),
  },
  {
    title: 'Speaker reimbursements',
    text: 'Travel is checked against the rules, then paid back on PayPal.',
    phone: (
      <>
        <p className="lp-piece-label">Speaker travel</p>
        <p className="lp-phone-line"><b>Over the limit</b></p>
        <StatusBadge status="risk" label="Waiting on approval" />
        <span className="lp-phone-btn">Treasurer decides</span>
      </>
    ),
  },
  {
    title: 'A report for every sponsor',
    text: 'Where each sponsor’s money went, by category and vendor.',
    phone: (
      <>
        <p className="lp-piece-label">Sponsor report</p>
        <p className="lp-phone-line"><b>Swag</b> <span className="num">{formatMoney(14_000)}</span></p>
        <p className="lp-phone-line"><b>Venue</b> <span className="num">{formatMoney(18_000)}</span></p>
        <p className="lp-piece-label">Shared by a private link.</p>
      </>
    ),
  },
];

export function PaysPeople() {
  const [open, setOpen] = useState(0);
  return (
    <section className="lp-section" aria-labelledby="lp-pay">
      <div className="lp-wrap lp-phonefeat">
        <div>
          <h2 id="lp-pay">Pays people back from a phone.</h2>
          <p className="lp-sub">Volunteers, speakers and winners get paid on PayPal, within the rules.</p>
          <div className="lp-flist" role="tablist" aria-label="What it pays">
            {PAYOUTS.map((item, i) => (
              <button
                key={item.title}
                type="button"
                role="tab"
                aria-selected={open === i}
                className="lp-fitem"
                onClick={() => setOpen(i)}
                onMouseEnter={() => setOpen(i)}
              >
                <b>{item.title}</b>
                {open === i && <span>{item.text}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="lp-phone" role="tabpanel" aria-label={PAYOUTS[open]!.title}>
          {PAYOUTS[open]!.phone}
        </div>
      </div>
    </section>
  );
}

// --- Try it in 3 minutes: three cards that open the demo at its strongest moments.
const TRIES = [
  { n: 1, title: 'Ask the agent to plan it', text: 'Tell it what you need; it builds the plan and you review it before paying.', to: '/agent' },
  { n: 2, title: 'Watch the plan wait for a sponsor', text: 'The swag order stays blocked until its sponsor’s invoice is paid.', to: '/plan' },
  { n: 3, title: 'Stop the agent in one click', text: 'Revoke its wallet; PayPal refuses the next payment, in every event.', to: '/settings' },
];

// A signed-in visitor just goes there: running the demo login again would replace their own session.
export function TryIt({ onTry, busy, signedIn }: { onTry: (to: string) => void; busy: boolean; signedIn: boolean }) {
  return (
    <section id="try" className="lp-section lp-tint" aria-labelledby="lp-try">
      <div className="lp-wrap">
        <h2 id="lp-try">Try it in 3 minutes.</h2>
        <p className="lp-sub">
          {signedIn ? 'Each card opens that moment in the demo.' : 'Each card signs you in to the demo and opens it at that moment.'}
        </p>
        <ul className="lp-tries">
          {TRIES.map((t) => (
            <li key={t.n} className="lp-try">
              <span className="lp-try-n">{t.n}</span>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
              {signedIn ? (
                <Link className="lp-link" to={t.to}>
                  Open in the demo ›
                </Link>
              ) : (
                <button type="button" className="lp-link" disabled={busy} onClick={() => onTry(t.to)}>
                  Open in the demo ›
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// --- How it works
const STEPS = [
  { title: 'Set up the event and your rules', text: 'Date, headcount, budget and sponsors; the rules in your own words.' },
  { title: 'Let the agent plan and buy the small things', text: 'It builds the plan, sources supplies and pays within the rules.' },
  { title: 'Approve the big moments yourself', text: 'Anything over your rules waits for you, with its reasons.' },
];

export function HowItWorks() {
  return (
    <section id="how" className="lp-section lp-center" aria-labelledby="lp-how">
      <div className="lp-wrap">
        <h2 id="lp-how">How it works</h2>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="lp-step-n num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// --- Credibility: the dark section.
const PROOF = [
  { k: 'RULES ENGINE', title: 'The model never decides a payment', text: 'Every spend passes one deterministic check: allow, needs approval or block.' },
  { k: 'FUNDS-GATED', title: 'Only cleared money unlocks spending', text: 'Pledges and sent invoices never count, per event.' },
  { k: 'PAYPAL VAULT', title: 'A kill switch PayPal enforces', text: 'Revoking the wallet deletes the payment token; the next charge fails at PayPal.' },
  { k: 'AUDIT LOG', title: 'Every decision is on the record', text: 'Input, reasoning, rule result and PayPal ID for each action.' },
];

export function Credibility() {
  return (
    <section className="lp-dark" aria-labelledby="lp-proof">
      <div className="lp-wrap">
        <h2 id="lp-proof">Rules are code, not prompts.</h2>
        <p className="lp-sub">An AI drafts and proposes. Fixed code decides what gets paid, and PayPal enforces the stop.</p>
        <dl className="lp-proofs">
          {PROOF.map((p) => (
            <div key={p.k}>
              <dt>{p.k}</dt>
              <dd>
                <b>{p.title}</b>
                {p.text}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// --- FAQ: native details, so it works without script and by keyboard.
const FAQ = [
  { q: 'Is this real money?', a: 'No. It runs on the PayPal sandbox; nothing real is charged or paid.' },
  { q: 'Can the agent spend without me?', a: 'Only inside rules you confirmed. A spend over a rule waits for your approval in PayPal, and a spend that breaks a rule is blocked.' },
  { q: 'What happens if I revoke the wallet?', a: 'The saved PayPal payment token is deleted, so PayPal refuses the agent’s next charge. You can connect a new wallet later.' },
  ...(LANDING.showMultiEvent
    ? [{ q: 'Can I run more than one event?', a: 'Yes. Each event keeps its own budget, plan, approvals, rules and claims, and they share one treasury and one agent wallet.' }]
    : []),
  { q: 'Which PayPal products does it use?', a: 'Log in with PayPal, Invoicing for sponsors, Orders and the PayPal button for approvals, the Vault for the agent’s wallet, and Payouts for people.' },
];

export function Faq() {
  return (
    <section id="faq" className="lp-section" aria-labelledby="lp-faq">
      <div className="lp-wrap lp-faq">
        <div>
          <h2 id="lp-faq">Questions</h2>
          <p className="lp-sub">The things organisers and judges ask first.</p>
        </div>
        <div>
          {FAQ.map((item, i) => (
            <details key={item.q} className="lp-q" open={i === 0}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- Closing line and the wordmark footer
export function Closing({ onEnter, busy, signedIn }: { onEnter: () => void; busy: boolean; signedIn: boolean }) {
  return (
    <section className="lp-section lp-center lp-final" aria-labelledby="lp-end">
      <div className="lp-wrap">
        <h2 id="lp-end">Hand the busywork to the agent. Keep the money decisions.</h2>
        <div className="lp-ctas lp-ctas--center">
          {signedIn ? (
            <Link className="btn btn-primary lp-btn-lg" to="/events">
              Open your events
            </Link>
          ) : (
            <button type="button" className="btn btn-primary lp-btn-lg" disabled={busy} onClick={onEnter}>
              Enter the demo
            </button>
          )}
          {LINKS.video && (
            <a className="btn btn-secondary lp-btn-lg" href={LINKS.video}>
              Watch the video
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-cols">
          <div>
            <b>{BRAND.name}</b>
            <p>Built for the PayPal AI Hackathon. PayPal sandbox, no real money.</p>
          </div>
          <div>
            <b>Product</b>
            <a href="#how">How it works</a>
            <a href="#try">Try the demo</a>
            <a href="#faq">FAQ</a>
          </div>
          <div>
            <b>Build</b>
            <a href={LINKS.github}>GitHub (MIT)</a>
            {LINKS.video && <a href={LINKS.video}>Demo video</a>}
          </div>
        </div>
        <div className="lp-footer-mark">
          <p className="lp-wordmark" aria-hidden="true">
            {BRAND.name}
          </p>
          <LeoMascot decorative className="lp-footer-leo" />
        </div>
      </div>
    </footer>
  );
}
