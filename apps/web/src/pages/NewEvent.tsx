import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreateEventResponse } from '@quartermaster/shared';
import {
  EVENT_CURRENCY,
  todayIso,
  validateEventForm,
  type EventFormErrors,
  type EventFormField,
  type EventFormValues,
} from '../events/eventForm';
import { ApiFailure, errorMessage, sendJson } from '../shell/api';
import { eventPath, useEvents } from '../shell/event';
import { useSession } from '../shell/session';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { useToast } from '../ui/Toast';

const EMPTY: EventFormValues = { name: '', date: '', endDate: '', people: '', budget: '', categories: '', city: '' };

// New event (F3): name, date, headcount, budget and categories, saved through POST /api/events. The treasury and the
// agent wallet are shared by every event, so there is nothing more to set up here. The budget is a target: what can be
// spent is the unlocked budget, which only grows as sponsor money clears.
export function NewEvent() {
  const navigate = useNavigate();
  const toast = useToast();
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
      toast.success(`${event.name} is ready. The agent is planning it.`);
      // The agent opens first and plans the event from these details; the state is read once there.
      navigate(eventPath(event.id, 'agent'), { state: { planEvent: true } });
    } catch (err) {
      setBusy(false);
      if (!(err instanceof ApiFailure)) setFailure('Something went wrong. Try again.');
      // 422 and 429 carry a message written for the person (past date, demo name, too many events).
      else if (err.status === 422 || err.status === 429) setFailure(err.message);
      else {
        const { title, detail } = errorMessage(err);
        setFailure(`${title}. ${detail}`);
      }
    }
  }

  return (
    <section>
      <PageHeader title="New event" description="Name, dates, headcount and budget. The agent for this event plans the rest as soon as you create it." />
      <form className="card event-form" onSubmit={submit} noValidate>
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
            {failure}
          </p>
        )}
        <div className="btn-row">
          <Button type="submit" variant="primary" busy={busy} busyLabel="Creating…">
            Create event
          </Button>
          <Link to="/events" className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
