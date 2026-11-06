import { CreateEventResponse, type EventSummary } from '@quartermaster/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  EVENT_CURRENCY,
  todayIso,
  validateEventForm,
  type EventFormErrors,
  type EventFormField,
  type EventFormValues,
} from '../events/eventForm';
import { TreasuryStatus } from '../setup/TreasuryStatus';
import { ApiFailure, errorMessage, sendJson } from '../shell/api';
import { useShellData } from '../shell/data';
import { eventPath, rememberEvent, useEvents } from '../shell/event';
import { useSession } from '../shell/session';
import { useConnectWallet } from '../shell/useConnectWallet';
import { walletConsequence } from '../shell/wallet';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';

// Event setup (UX plan 1, screen 2), three steps: the event, the treasury, the agent wallet. Only step 1 saves
// anything; the treasury and the wallet are shared by every event, so steps 2 and 3 confirm what is already there.
// Leaving the last step opens the agent, which plans the event from the details saved in step 1.
const STEPS = ['The event', 'Treasury', 'Agent wallet'] as const;

const walletBadge = {
  active: { status: 'done', label: 'Connected' },
  revoked: { status: 'blocked', label: 'Revoked' },
  none: { status: 'pending', label: 'Not connected' },
} as const;

const EMPTY: EventFormValues = { name: '', date: '', endDate: '', people: '', budget: '', categories: '', city: '' };

export function NewEvent() {
  const [step, setStep] = useState(0);
  const [event, setEvent] = useState<EventSummary | null>(null);

  return (
    <section className="setup">
      <PageHeader
        title="New event"
        description="Three steps: the event, the treasury, and the wallet the agent pays from. Then the agent plans the rest."
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

// Name, dates, headcount, budget, city and categories, saved through POST /api/events. The budget is a target: what
// can be spent is the unlocked budget, which only grows as sponsor money clears.
function EventStep({ onCreated }: { onCreated: (event: EventSummary) => void }) {
  const { add } = useEvents();
  const { session } = useSession();
  const [values, setValues] = useState<EventFormValues>(EMPTY);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const bind = (field: EventFormField) => ({
    value: values[field],
    error: errors[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [field]: e.target.value }));
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFailure(null);
    const checked = validateEventForm(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      document.getElementById(`event-${Object.keys(checked.errors)[0]}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { event } = await sendJson('/api/events', CreateEventResponse, checked.request);
      // The new event is in the list before we go there, so its screens never flash "This event isn't here".
      add(event);
      rememberEvent(event.id);
      onCreated(event);
    } catch (err) {
      setBusy(false);
      if (!(err instanceof ApiFailure)) setFailure('Something went wrong. Try again.');
      else if (err.status === 401) setFailure('signin');
      // 422 and 429 carry a message written for the person (past date, demo name, too many events).
      else if (err.status === 422 || err.status === 429) setFailure(err.message);
      else {
        const { title, detail } = errorMessage(err);
        setFailure(`${title}. ${detail}`);
      }
    }
  }

  return (
    <Card title="The event">
      <form className="event-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field id="event-name" label="Event name" autoComplete="off" maxLength={120} required {...bind('name')} />
        <div className="event-form-row">
          <Field id="event-date" label="First day" type="date" min={todayIso()} required {...bind('date')} />
          <Field id="event-end-date" label="Last day" type="date" min={values.date || todayIso()} required {...bind('endDate')} />
        </div>
        <div className="event-form-row">
          <Field
            id="event-people"
            label="People coming"
            inputMode="numeric"
            autoComplete="off"
            required
            {...bind('people')}
          />
        </div>
        <Field
          id="event-budget"
          label={`Budget (${EVENT_CURRENCY})`}
          inputMode="decimal"
          autoComplete="off"
          hint="A target to plan around, not money you can spend. Spending unlocks as sponsor money clears."
          required
          {...bind('budget')}
        />
        <Field
          id="event-city"
          label="City (optional)"
          autoComplete="off"
          maxLength={100}
          hint="The agent searches venues here. The demo listings cover Indonesia, Malaysia and Singapore."
          {...bind('city')}
        />
        <Field
          id="event-categories"
          label="Spend categories (optional)"
          autoComplete="off"
          hint="Separate with commas, for example venue, swag, food."
          {...bind('categories')}
        />
        {session.status === 'signed-in' && session.via === 'demo' && (
          <p className="muted">This event belongs to your demo sign-in. It disappears from your list when that sign-in ends.</p>
        )}
        {failure && (
          <p className="field-error" role="alert">
            {failure === 'signin' ? (
              <>
                Your session expired. <Link to="/signin">Sign in</Link> to create an event.
              </>
            ) : (
              failure
            )}
          </p>
        )}
        <div className="btn-row">
          <Button type="submit" variant="primary" busy={busy} busyLabel="Saving…">
            Continue
          </Button>
          <Link to="/events" className="btn btn-secondary">
            Cancel
          </Link>
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
  // The agent opens first and plans the event from its saved details; the state is read once there.
  const open = () => navigate(eventPath(event.id, 'agent'), { state: { planEvent: true } });

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
            Plan {event.name} with the agent
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
