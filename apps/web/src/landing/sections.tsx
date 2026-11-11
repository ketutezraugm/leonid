import { Fragment, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../ui/BrandMark';
import { BudgetBar, unlockedToSpend, type BudgetFigures } from '../ui/BudgetBar';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';
import { BRAND, LANDING, LINKS } from '../brand';
import { LeoMascot } from './LeoMascot';
import { revealAt, useReveal } from './useReveal';

// The demo event's figures, as the demo shows them (cleared $3,000 − committed $1,860 = $1,140 unlocked).
const DEMO_BUDGET: BudgetFigures = {
  currency: 'USD',
  cleared: 300_000,
  committed: 186_000,
  invoiced: 250_000,
  pledged: 250_000,
};

// The name as the landing sets it: lowercase "leonid" with the "eo" in the meteor color. The "eo" is the event
// organizer, the person Leonid is for, and Leo, the agent and the EO's best friend, lives in the same letters.
// Landing, hero and video only: inside the app the wordmark is one color. Decorative: callers give the real name.
function NameWithEo() {
  const word = BRAND.name.toLowerCase();
  const at = word.indexOf('eo');
  if (at < 0) return <>{word}</>;
  return (
    <>
      {word.slice(0, at)}
      <span className="lp-eo">eo</span>
      {word.slice(at + 2)}
    </>
  );
}

// Screen readers hear the name, not the split letters.
export function Wordmark() {
  return (
    <span className="lp-brand">
      <BrandMark />
      <span className="visually-hidden">{BRAND.name}</span>
      <span aria-hidden="true">
        <NameWithEo />
      </span>
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

// --- Small meteors on the dark grounds (the hero and the credibility band): copies of the mark that drift a few
// pixels along their own streak; one now and then shoots across in under a second. Placed clear of text and buttons.
type Meteor = { top: string; left: string; size: number; drift: number; delay: number; shoot?: boolean };
const METEORS: Record<'hero' | 'dark', Meteor[]> = {
  hero: [
    { top: '9%', left: '47%', size: 18, drift: 7, delay: 0 },
    { top: '16%', left: '93%', size: 12, drift: 9, delay: -3 },
    { top: '84%', left: '50%', size: 14, drift: 8, delay: -5 },
    { top: '74%', left: '95%', size: 10, drift: 10, delay: -2 },
    { top: '40%', left: '3%', size: 9, drift: 11, delay: -6 },
    { top: '4%', left: '70%', size: 16, drift: 9, delay: 0, shoot: true },
  ],
  dark: [
    { top: '12%', left: '88%', size: 14, drift: 8, delay: -1 },
    { top: '22%', left: '95%', size: 9, drift: 10, delay: -4 },
    { top: '8%', left: '62%', size: 14, drift: 10, delay: 2, shoot: true },
  ],
};

export function Meteors({ set }: { set: 'hero' | 'dark' }) {
  return (
    <div className="lp-meteors" aria-hidden="true">
      {METEORS[set].map((m, i) => (
        <svg
          key={i}
          className={m.shoot ? 'lp-meteor lp-meteor--shoot' : 'lp-meteor'}
          viewBox="0 0 32 32"
          style={{ top: m.top, left: m.left, width: m.size * 2, '--drift': `${m.drift}s`, '--delay': `${m.delay}s` } as CSSProperties}
        >
          <path d="M26.5 5.5 10.4 19.6 12.6 21.8Z" />
          <circle cx="10.6" cy="21.4" r="3.4" />
        </svg>
      ))}
    </div>
  );
}

// A heading whose words rise out of a light blur one after another when its section scrolls in (useReveal).
function RevealWords({ text }: { text: string }) {
  return text.split(' ').map((word, i, words) => (
    <Fragment key={i}>
      <span className="lp-rw" style={{ '--w': i } as CSSProperties}>
        {word}
      </span>
      {i < words.length - 1 ? ' ' : null}
    </Fragment>
  ));
}

// --- Built with: names only, never logos.
const BUILT_WITH = ['PayPal (Invoicing, Vault, Orders, Payouts)', 'Bryntum Gantt', 'AG Studio', 'Render', 'APIMatic'];

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
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className="lp-section lp-center" aria-labelledby="lp-view">
      <div className="lp-wrap">
        <h2 id="lp-view" data-reveal style={revealAt(0)}>
          Your event, planned and paid, in one view.
        </h2>
        <p className="lp-sub" data-reveal style={revealAt(1)}>
          The plan, the money and what needs you, side by side.
        </p>
        <div className="lp-shot-card" data-tilt data-reveal="drop" style={revealAt(2)}>
          <img
            className="lp-shot"
            src="/landing/event-home.png"
            width={1440}
            height={900}
            alt="Event home: $1,140.00 unlocked, recent spends and the plan"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}

// --- Four feature rows: text beside a real piece of the product, alternating sides.
// Each row reveals as it scrolls in: the title, line and points rise one by one while the product card drops in.
function Feature({ id, flip, title, text, points, children }: { id: string; flip?: boolean; title: string; text: string; points: string[]; children: ReactNode }) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className="lp-section" aria-labelledby={id}>
      <div className={`lp-wrap lp-feature${flip ? ' lp-feature--flip' : ''}`}>
        <div>
          <h2 id={id} data-reveal style={revealAt(0)}>
            {title}
          </h2>
          <p className="lp-sub" data-reveal style={revealAt(1)}>
            {text}
          </p>
          <ul className="lp-points">
            {points.map((p, i) => (
              <li key={p} data-reveal style={revealAt(i + 2)}>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-piece" data-tilt data-reveal="drop" style={revealAt(1)}>
          {children}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <>
      <Feature
        id="lp-money"
        title="Know what’s cleared, what’s committed and what’s left."
        text="Pledges and sent invoices never count as cash. The figure moves as sponsors actually pay."
        points={[
          'Sponsor invoices drafted by the agent, sent through PayPal',
          'Unlocked = cleared income minus what is committed',
          'Each event keeps its own budget',
        ]}
      >
        <p className="lp-piece-label">Unlocked budget · OpenHack 2027</p>
        <p className="lp-piece-fig num">{formatMoney(unlockedToSpend(DEMO_BUDGET))}</p>
        <BudgetBar figures={DEMO_BUDGET} />
      </Feature>

      <Feature
        id="lp-rules"
        flip
        title="Set the rules once. It never crosses them."
        text="Set a max spend and your limits. They are fixed rules in code, and the agent can’t argue its way around them."
        points={['Spending caps, approved vendors, claim limits', 'The strictest rule wins', 'Every check is logged']}
      >
        <p className="lp-piece-label">Rules</p>
        <div className="lp-rule">
          <span>“Never spend more than $1,000 on swag.”</span>
          <code>categoryCap: swag 100000 USD → block</code>
        </div>
        <div className="lp-rule">
          <span>“Volunteers can claim up to $50 a day.”</span>
          <code>claimCap: 5000 USD / person / day</code>
        </div>
      </Feature>

      <Feature
        id="lp-approve"
        title="Every spend is checked first."
        text="Before any payment, the rules engine allows it or blocks it, and says why. The model never decides."
        points={[
          'The rule that decided, in plain words',
          'The agent’s reasoning and the options it compared',
          'Every decision is logged with its PayPal ID',
        ]}
      >
        <div className="lp-appr">
          <b>Swag cart · Gold Prints</b>
          <span className="lp-piece-fig lp-piece-fig--sm num">{formatMoney(14_000)}</span>
        </div>
        <StatusBadge status="blocked" label="Not on your approved vendors" />
        <p className="lp-piece-label">Blocked before any money moved. The check and its reason are in the audit log.</p>
      </Feature>

      <Feature
        id="lp-plan"
        flip
        title="One plan, built from one sentence."
        text="The agent builds a Gantt plan from your goal, and each purchase shows which sponsor funds it."
        points={['A Gantt plan the agent builds from one sentence', 'Each purchase shows the sponsor that funds it', 'Event day stays fixed']}
      >
        <p className="lp-piece-label">Plan</p>
        <div className="lp-gantt" role="img" aria-label="The sponsor invoice, the swag order and its delivery on one plan; event day is fixed">
          <div className="lp-grow">
            <span>Sponsor invoice</span>
            <span className="lp-track">
              <i className="lp-bar-progress" style={{ left: '4%', width: '30%' }} />
            </span>
          </div>
          <div className="lp-grow">
            <span>Order swag</span>
            <span className="lp-track">
              <i className="lp-bar-progress" style={{ left: '36%', width: '22%' }} />
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
        <p className="lp-piece-label">Swag is labelled with the sponsor that funds it. Plan drawn with Bryntum Gantt.</p>
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
        <p className="lp-phone-line"><b>Under the limit</b> <StatusBadge status="done" label="Paid" /></p>
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
  // dir: which way the list moved, so the phone's screen slides in from the same side.
  const [{ open, dir }, setView] = useState({ open: 0, dir: 1 });
  const show = (i: number) => setView((v) => (v.open === i ? v : { open: i, dir: i > v.open ? 1 : -1 }));
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
                onClick={() => show(i)}
                onMouseEnter={() => show(i)}
              >
                <b>{item.title}</b>
                {open === i && <span>{item.text}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="lp-phone" data-tilt role="tabpanel" aria-label={PAYOUTS[open]!.title}>
          <div key={open} className="lp-phone-screen" style={{ '--dir': dir } as CSSProperties}>
            {PAYOUTS[open]!.phone}
          </div>
        </div>
      </div>
    </section>
  );
}

// --- Try it in 3 minutes: three cards that open the demo at its strongest moments.
const TRIES = [
  { n: 1, title: 'Ask the agent to plan it', text: 'Tell it what you need; it builds the plan and you review it before paying.', to: '/agent' },
  { n: 2, title: 'See who funds each purchase', text: 'Each purchase is labelled with its sponsor, and a paid invoice updates the plan.', to: '/plan' },
  { n: 3, title: 'Stop the agent in one click', text: 'Revoke its wallet; PayPal refuses the next payment, in every event.', to: '/settings' },
];

// A signed-in visitor just goes there: running the demo login again would replace their own session.
export function TryIt({ onTry, busy, signedIn }: { onTry: (to: string) => void; busy: boolean; signedIn: boolean }) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id="try" className="lp-section lp-tint" aria-labelledby="lp-try">
      <div className="lp-wrap">
        <h2 id="lp-try">
          <RevealWords text="Try it in 3 minutes." />
        </h2>
        <p className="lp-sub" data-reveal style={revealAt(2)}>
          {signedIn ? 'Each card opens that moment in the demo.' : 'Each card signs you in to the demo and opens it at that moment.'}
        </p>
        <ul className="lp-tries">
          {TRIES.map((t, i) => (
            <li key={t.n} className="lp-try" data-tilt data-reveal style={revealAt(i + 3)}>
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
  { title: 'Keep the last word', text: 'Revoke the agent’s wallet at any time and PayPal refuses its next charge. Every decision is on the record.' },
];

export function HowItWorks() {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id="how" className="lp-section lp-center" aria-labelledby="lp-how">
      <div className="lp-wrap">
        <h2 id="lp-how">
          <RevealWords text="How it works" />
        </h2>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} data-reveal style={revealAt(i + 2)}>
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
  { k: 'RULES ENGINE', title: 'The model never decides a payment', text: 'Every spend passes one deterministic check: allow or block.' },
  { k: 'LIVE FROM PAYPAL', title: 'Cleared money is counted, never guessed', text: 'Income comes from PayPal’s own webhooks, per event.' },
  { k: 'PAYPAL VAULT', title: 'A kill switch PayPal enforces', text: 'Revoking the wallet deletes the payment token; the next charge fails at PayPal.' },
  { k: 'AUDIT LOG', title: 'Every decision is on the record', text: 'Input, reasoning, rule result and PayPal ID for each action.' },
];

export function Credibility() {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className="lp-dark" aria-labelledby="lp-proof">
      <Meteors set="dark" />
      <div className="lp-wrap">
        <h2 id="lp-proof">
          <RevealWords text="Rules are code, not prompts." />
        </h2>
        <p className="lp-sub" data-reveal style={revealAt(2)}>
          An AI drafts and proposes. Fixed code decides what gets paid, and PayPal enforces the stop.
        </p>
        <dl className="lp-proofs">
          {PROOF.map((p, i) => (
            <div key={p.k} data-reveal style={revealAt(i + 3)}>
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
  { q: 'Can the agent spend without me?', a: 'Only inside the rules you set. A spend that breaks a rule is blocked, and you can revoke its wallet at any time.' },
  { q: 'What happens if I revoke the wallet?', a: 'The saved PayPal payment token is deleted, so PayPal refuses the agent’s next charge. You can connect a new wallet later.' },
  ...(LANDING.showMultiEvent
    ? [{ q: 'Can I run more than one event?', a: 'Yes. Each event keeps its own budget, plan, rules and claims, and they share one treasury and one agent wallet.' }]
    : []),
  { q: 'Which PayPal products does it use?', a: 'Log in with PayPal, Invoicing for sponsors, Orders and the PayPal button for payments, the Vault for the agent’s wallet, and Payouts for people.' },
];

export function Faq() {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id="faq" className="lp-section" aria-labelledby="lp-faq">
      <div className="lp-wrap lp-faq">
        <div>
          <h2 id="lp-faq">
            <RevealWords text="Questions" />
          </h2>
          <p className="lp-sub" data-reveal style={revealAt(1)}>
            The things organisers and judges ask first.
          </p>
        </div>
        <div>
          {FAQ.map((item, i) => (
            <details key={item.q} className="lp-q" open={i === 0} data-reveal style={revealAt(i + 2)}>
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

// The footer is an inset card: the links and the motto with one way in, then one line along the bottom: the name,
// cropped by the card's edge, and Leo's sticker beside it.
export function LandingFooter() {
  const ring = `lp-ring-${useId().replace(/:/g, '')}`;
  return (
    <footer className="lp-footer">
      <div className="lp-footer-card">
        <div className="lp-footer-top">
          <nav className="lp-footer-cols" aria-label="Footer">
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
          </nav>
          <div className="lp-footer-cta">
            <p className="lp-footer-motto">Every event, on course.</p>
            <a className="btn lp-btn-light" href="#try">
              Try the demo
            </a>
            <p className="lp-footer-fine">
              {BRAND.name} · Built for the PayPal AI Hackathon. PayPal sandbox, no real money.
            </p>
          </div>
        </div>
        <div className="lp-footer-mark" aria-hidden="true">
          <span className="lp-wordmark">
            <NameWithEo />
          </span>
          <span className="lp-sticker">
            <svg className="lp-sticker-ring" viewBox="0 0 200 200">
              <defs>
                <path id={ring} d="M100 100 m-82 0 a82 82 0 1 1 164 0 a82 82 0 1 1 -164 0" />
              </defs>
              <circle cx="100" cy="100" r="98" />
              <text>
                <textPath href={`#${ring}`}>EVERY EVENT · ON COURSE · EVERY EVENT · ON COURSE ·</textPath>
              </text>
            </svg>
            <LeoMascot decorative className="lp-sticker-leo" />
          </span>
        </div>
      </div>
    </footer>
  );
}
