import { useState, type FormEvent } from 'react';
import {
  BOOKING_ITEMS,
  bookingChoiceText,
  type BookingItemId,
  type ChooseBookingsInput,
} from '@quartermaster/shared';

const EXTRA_MAX_LENGTH = 300;

// What to book for the event, as a checklist. The items are a fixed list from the shared contract;
// the agent only pre-ticks its suggestions. The choice goes back as one user message.
export function BookingsCard({
  input,
  active,
  onAnswer,
}: {
  input: ChooseBookingsInput;
  // False once the conversation has moved on or a run is in progress.
  active: boolean;
  onAnswer: (text: string) => void;
}) {
  const [chosen, setChosen] = useState<BookingItemId[]>(input.suggested);
  const [extra, setExtra] = useState('');
  const count = chosen.length + (extra.trim() ? 1 : 0);

  function toggle(id: BookingItemId) {
    setChosen((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!active || count === 0) return;
    onAnswer(bookingChoiceText({ chosen, extra: extra.trim() || null }));
  }

  return (
    <form className="bookings" onSubmit={onSubmit} aria-label="What to book">
      <fieldset disabled={!active}>
        <legend>
          <strong>What do you want to book for this event?</strong>
          <span className="muted">
            These are what events usually pay for. Ticked ones are suggestions; the agent plans and
            searches only for what you keep.
          </span>
        </legend>
        <ul className="bookings-list">
          {BOOKING_ITEMS.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.includes(item.id)}
                  onChange={() => toggle(item.id)}
                />
                <span>
                  <strong>{item.label}</strong>
                  <span className="muted">{item.description}</span>
                </span>
                {input.suggested.includes(item.id) && (
                  <small className="bookings-suggested">Suggested</small>
                )}
              </label>
            </li>
          ))}
        </ul>
        <input
          className="bookings-extra"
          aria-label="Anything else to book"
          placeholder="Anything else? (optional)"
          maxLength={EXTRA_MAX_LENGTH}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
      </fieldset>
      {active && (
        <button type="submit" className="ask-user-submit" disabled={count === 0}>
          {count === 0 ? 'Pick at least one' : `Plan ${count} ${count === 1 ? 'item' : 'items'}`}
        </button>
      )}
    </form>
  );
}
