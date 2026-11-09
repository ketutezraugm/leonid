import { useState, type FormEvent } from 'react';
import {
  BOOKING_ITEMS,
  bookingChoiceText,
  isBookingAvailable,
  type BookingItemId,
  type ChooseBookingsInput,
} from '@quartermaster/shared';

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
  // In-development items can be seen but not chosen, even if the agent suggested one.
  const [chosen, setChosen] = useState<BookingItemId[]>(() =>
    input.suggested.filter(isBookingAvailable),
  );
  const count = chosen.length;

  function toggle(id: BookingItemId) {
    setChosen((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!active || count === 0) return;
    onAnswer(bookingChoiceText({ chosen, extra: null }));
  }

  return (
    <form className="bookings" onSubmit={onSubmit} aria-label="What to book">
      <fieldset disabled={!active}>
        <legend>
          <strong>What do you want to book for this event?</strong>
          <span className="muted">
            These are what events usually pay for. The venue is ready today, with seeded venues and
            a plan you pay for with PayPal; the rest are still in development.
          </span>
        </legend>
        <ul className="bookings-list">
          {BOOKING_ITEMS.map((item) => (
            <li key={item.id}>
              <label className={item.available ? undefined : 'is-unavailable'}>
                <input
                  type="checkbox"
                  checked={item.available && chosen.includes(item.id)}
                  disabled={!item.available}
                  onChange={() => toggle(item.id)}
                />
                <span>
                  <strong>{item.label}</strong>
                  <span className="muted">{item.description}</span>
                </span>
                {!item.available ? (
                  <small className="bookings-soon">In development</small>
                ) : (
                  input.suggested.includes(item.id) && (
                    <small className="bookings-suggested">Suggested</small>
                  )
                )}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {active && (
        <button type="submit" className="ask-user-submit" disabled={count === 0}>
          {count === 0 ? 'Pick at least one' : `Plan ${count} ${count === 1 ? 'item' : 'items'}`}
        </button>
      )}
    </form>
  );
}
