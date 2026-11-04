import { EventSummary } from '@quartermaster/shared';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TreasuryStatus } from '../setup/TreasuryStatus';
import { ApiFailure, errorMessage, sendJson } from '../shell/api';
import { useShellData } from '../shell/data';
import { eventPath, rememberEvent, useEvents } from '../shell/event';
import { useConnectWallet } from '../shell/useConnectWallet';
import { walletConsequence } from '../shell/wallet';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatMoney, parseMoneyInput } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';

// Event setup (UX plan 1, screen 2), three steps: the event, the treasury, the agent wallet. Only step 1 saves
// anything; the treasury and the wallet are shared by every event, so steps 2 and 3 confirm what is already there.
const STEPS = ['The event', 'Treasury', 'Agent wallet'] as const;

const walletBadge = {
  active: { status: 'done', label: 'Connected' },
  revoked: { status: 'blocked', label: 'Revoked' },
  none: { status: 'pending', label: 'Not connected' },
} as const;

type Field = 'name' | 'date' | 'people' | 'budget';
type Errors = Partial<Record<Field, string>>;

function validate(form: Record<Field, string>): { errors: Errors; budget: number | null } {
  const errors: Errors = {};
  if (!form.name.trim()) errors.name = 'Give the event a name.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = 'Pick the event day.';
  const people = Number(form.people);
  if (!Number.isInteger(people) || people < 1)
    errors.people = 'How many people are coming? A whole number, 1 or more.';
  const budget = parseMoneyInput(form.budget);
  if (!budget) errors.budget = 'Enter the budget in dollars, like 8,000.';
  return { errors, budget };
}

export function NewEvent() {
  const [step, setStep] = useState(0);
  const [event, setEvent] = useState<EventSummary | null>(null);

  return (
    <section className="setup">
      <PageHeader
        title="New event"
        description="Three steps: the event, the treasury, and the wallet the agent pays from."
      />
      <ol className="setup-steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? 'step' : undefined}
            data-done={i < step || undefined}
          >
            <span className="setup-step-num">{i + 1}</span> {label}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <EventStep
          onCreated={(created) => {
            setEvent(created);
            setStep(1);
          }}
        />
      )}
      {step === 1 && event && <TreasuryStep event={event} onNext={() => setStep(2)} />}
      {step === 2 && event && <WalletStep event={event} />}
    </section>
  );
}

function EventStep({ onCreated }: { onCreated: (event: EventSummary) => void }) {
  const { refresh } = useEvents();
  const [form, setForm] = useState<Record<Field, string>>({
    name: '',
    date: '',
    people: '',
    budget: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: Field) => (e: { target: { value: string } }) =>
    setForm({ ...form, [field]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { errors: found, budget } = validate(form);
    setErrors(found);
    setProblem(null);
    const first = (Object.keys(found) as Field[])[0];
    if (first) document.getElementById(`event-${first}`)?.focus();
    if (first || !budget) return;
    setSaving(true);
    try {
      const created = await sendJson('/api/events', EventSummary, {
        name: form.name.trim(),
        date: form.date,
        people: Number(form.people),
        budget,
        currency: 'USD',
      });
      rememberEvent(created.id);
      refresh();
      onCreated(created);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiFailure && err.status === 401) setProblem('signin');
      else if (err instanceof ApiFailure && err.status === 404)
        setProblem('Creating events isn’t available on this server yet.');
      else if (err instanceof ApiFailure && err.status === 422)
        setProblem('Check the fields and try again.');
      else if (err instanceof ApiFailure && err.status !== 500) {
        const { title, detail } = errorMessage(err);
        setProblem(`${title}. ${detail}`);
      } else setProblem("Couldn't save the event. Try again.");
    }
  }

  const field = (name: Field, label: string, input: ReactElement, hint?: string) => (
    <div className="field">
      <label htmlFor={`event-${name}`}>{label}</label>
      {input}
      {hint && !errors[name] && <span className="field-hint">{hint}</span>}
      {errors[name] && (
        <span className="field-error" id={`event-${name}-error`}>
          {errors[name]}
        </span>
      )}
    </div>
  );
  const describe = (name: Field) => ({
    id: `event-${name}`,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `event-${name}-error` : undefined,
  });

  return (
    <Card title="The event">
      <form className="setup-form" onSubmit={(e) => void submit(e)} noValidate>
        {field(
          'name',
          'Event name',
          <input
            {...describe('name')}
            value={form.name}
            onChange={set('name')}
            maxLength={120}
            autoComplete="off"
          />,
        )}
        {field(
          'date',
          'Event day',
          <input {...describe('date')} type="date" value={form.date} onChange={set('date')} />,
        )}
        {field(
          'people',
          'People coming',
          <input
            {...describe('people')}
            inputMode="numeric"
            value={form.people}
            onChange={set('people')}
          />,
        )}
        {field(
          'budget',
          'Budget (US dollars)',
          <input
            {...describe('budget')}
            inputMode="decimal"
            value={form.budget}
            onChange={set('budget')}
            placeholder="8,000"
          />,
          'Only money that has cleared is ever spendable; the budget is the plan.',
        )}
        {problem && (
          <p role="alert" className="field-error">
            {problem === 'signin' ? (
              <>
                Your session expired. <Link to="/signin">Sign in</Link> to create an event.
              </>
            ) : (
              problem
            )}
          </p>
        )}
        <div className="btn-row">
          <Button type="submit" variant="primary" busy={saving} busyLabel="Saving…">
            Continue
          </Button>
          <Link to="/events">Cancel</Link>
        </div>
      </form>
    </Card>
  );
}

function TreasuryStep({ event, onNext }: { event: EventSummary; onNext: () => void }) {
  return (
    <Card title="Treasury">
      <p>
        <strong>{event.name}</strong> is saved: {formatMoney(event.budget, event.currency)} budget,{' '}
        {event.people} people.
      </p>
      <p>
        Sponsor money for this event lands in the treasury, the organisation’s own PayPal account.
        There is nothing to connect.
      </p>
      <TreasuryStatus />
      <div className="btn-row">
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </div>
    </Card>
  );
}

function WalletStep({ event }: { event: EventSummary }) {
  const navigate = useNavigate();
  const { wallet } = useShellData();
  const { connect, connecting } = useConnectWallet();
  const open = () => navigate(eventPath(event.id));

  return (
    <Card title="Agent wallet">
      <p>
        The agent pays for things from one PayPal wallet, within your rules. Every event shares it.
      </p>
      {wallet.kind === 'loading' && <p className="muted">Checking the wallet…</p>}
      {wallet.kind === 'error' && (
        <p className="muted">Couldn’t check the wallet. You can connect it later in Settings.</p>
      )}
      {wallet.kind === 'ready' && (
        <>
          <p>
            <StatusBadge {...walletBadge[wallet.data.status]} />
          </p>
          <p>{walletConsequence(wallet.data.status)}</p>
        </>
      )}
      <div className="btn-row">
        {wallet.kind === 'ready' && wallet.data.status === 'active' ? (
          <Button variant="primary" onClick={open}>
            Open {event.name}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              busy={connecting}
              busyLabel="Opening PayPal…"
              onClick={() => void connect()}
            >
              Connect wallet
            </Button>
            <Button onClick={open}>Skip for now</Button>
          </>
        )}
      </div>
      {!(wallet.kind === 'ready' && wallet.data.status === 'active') && (
        <p className="field-hint">
          PayPal brings you back to All events afterwards; {event.name} is already saved there.
        </p>
      )}
    </Card>
  );
}
