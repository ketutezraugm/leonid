import { EventSummary, SetMaxSpendRequest } from '@leonid/shared';
import { useState, type FormEvent } from 'react';
import { ApiFailure, errorMessage, sendJson } from '../shell/api';
import { useEvents, type EventInfo } from '../shell/event';
import { ConfirmDialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { formatMoney, parseMoneyInput } from '../ui/money';
import { useToast } from '../ui/Toast';

type MaxSpendEvent = Pick<EventInfo, 'name' | 'currency' | 'maxSpend'> & { id: string };

// The organizer's one spending rule: the most the agent may commit for this event, as a plain amount. Past it the rules
// engine blocks the spend (the max_spend rule), whatever the agent asks for. Leaving the field empty removes it.
export function MaxSpendButton({ event }: { event: MaxSpendEvent }) {
  const [open, setOpen] = useState(false);
  const current = event.maxSpend ?? null;
  return (
    <>
      <button
        type="button"
        className="chat-toggle"
        onClick={() => setOpen(true)}
        aria-label={current === null ? 'Add rule: set a max spend' : `Max spend ${formatMoney(current, event.currency)}, change`}
      >
        {current === null ? 'Add rule' : `Max ${formatMoney(current, event.currency)}`}
      </button>
      {open && <MaxSpendDialog event={event} onClose={() => setOpen(false)} />}
    </>
  );
}

function MaxSpendDialog({ event, onClose }: { event: MaxSpendEvent; onClose: () => void }) {
  const { refresh } = useEvents();
  const toast = useToast();
  const current = event.maxSpend ?? null;
  const [text, setText] = useState(() => (current === null ? '' : toInput(current, event.currency)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const trimmed = text.trim();
    const maxSpend = trimmed === '' ? null : parseMoneyInput(trimmed, event.currency);
    if (trimmed !== '' && (maxSpend === null || maxSpend <= 0)) {
      setError('Enter an amount above zero, like 5000 or 5,000.50.');
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await sendJson(
        `/api/events/${encodeURIComponent(event.id)}/max-spend`,
        EventSummary,
        SetMaxSpendRequest.parse({ maxSpend }),
        'PUT',
      );
      refresh();
      toast.success(
        maxSpend === null
          ? 'Max spend removed.'
          : `The agent can spend at most ${formatMoney(maxSpend, event.currency)} on ${event.name}.`,
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err instanceof ApiFailure ? err : new ApiFailure(0, '')).title);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy) void save();
  }

  return (
    <ConfirmDialog
      title="Max spend"
      confirmLabel="Save rule"
      busyLabel="Saving…"
      busy={busy}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <form onSubmit={onSubmit}>
        <Field
          id="max-spend"
          label={`Most the agent can spend (${event.currency})`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="5000"
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
          hint={
            current === null
              ? 'Anything that would take this event past it is blocked. Leave empty for no maximum.'
              : `Now ${formatMoney(current, event.currency)}. Leave empty to remove it.`
          }
        />
      </form>
    </ConfirmDialog>
  );
}

// The field shows the amount as typed, without a currency symbol: 500000 cents is "5000", 500050 is "5000.50".
function toInput(minor: number, currency: string): string {
  return formatMoney(minor, currency).replace(/[^\d.]/g, '').replace(/\.00$/, '');
}
