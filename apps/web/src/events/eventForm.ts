import { CreateEventRequest, EVENT_CATEGORIES_MAX, EVENT_CATEGORY_MAX_LENGTH, EVENT_CITY_MAX_LENGTH } from '@quartermaster/shared';
import { parseMoneyInput } from '../ui/money';

// The setup form's fields exactly as typed, and what they become: the shared CreateEventRequest, or a message per field.
// The server checks again (and owns the past-date rule's clock); this only saves a round trip and says what to fix.
export interface EventFormValues {
  name: string;
  date: string;
  endDate: string;
  people: string;
  budget: string;
  categories: string;
  city: string;
}

export type EventFormField = keyof EventFormValues;
export type EventFormErrors = Partial<Record<EventFormField, string>>;

// Only USD for now: the rules every event shares are written in dollars (money-safety.md).
export const EVENT_CURRENCY = 'USD';

/** Splits "venue, Swag ,venue" into ["venue", "swag"]: trimmed, lower case, no repeats, in the order typed. */
export function parseCategories(text: string): string[] {
  return [...new Set(text.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean))];
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function validateEventForm(
  values: EventFormValues,
  now = new Date(),
): { ok: true; request: CreateEventRequest } | { ok: false; errors: EventFormErrors } {
  const errors: EventFormErrors = {};

  if (!values.name.trim()) errors.name = 'Enter a name for the event.';
  else if (values.name.trim().length > 120) errors.name = 'Use 120 characters or fewer.';

  if (!values.date) errors.date = 'Pick the first day.';
  else if (values.date < todayIso(now)) errors.date = 'Pick today or a later day.';

  if (!values.endDate) errors.endDate = 'Pick the last day (the same day for a one-day event).';
  else if (values.date && values.endDate < values.date) errors.endDate = 'The last day cannot be before the first day.';

  const people = /^\d+$/.test(values.people.trim()) ? Number(values.people.trim()) : NaN;
  if (!Number.isSafeInteger(people) || people < 1) errors.people = 'Enter how many people are coming, as a whole number.';

  const budget = parseMoneyInput(values.budget, EVENT_CURRENCY);
  if (budget === null) errors.budget = 'Enter an amount like 8000 or 8,000.00.';

  const categories = parseCategories(values.categories);
  if (categories.length > EVENT_CATEGORIES_MAX) errors.categories = `Use up to ${EVENT_CATEGORIES_MAX} categories.`;
  else if (categories.some((c) => c.length > EVENT_CATEGORY_MAX_LENGTH)) {
    errors.categories = `Keep each category under ${EVENT_CATEGORY_MAX_LENGTH} characters.`;
  }

  if (values.city.trim().length > EVENT_CITY_MAX_LENGTH) errors.city = `Use ${EVENT_CITY_MAX_LENGTH} characters or fewer.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = CreateEventRequest.safeParse({
    name: values.name,
    date: values.date,
    endDate: values.endDate,
    people,
    currency: EVENT_CURRENCY,
    budget,
    categories,
    city: values.city.trim() || undefined,
  });
  if (parsed.success) return { ok: true, request: parsed.data };

  // The shared limits (a huge headcount or budget) that the checks above do not repeat.
  const out: EventFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === 'name' || field === 'date' || field === 'endDate' || field === 'people' || field === 'budget' || field === 'categories' || field === 'city') {
      out[field] ??= field === 'budget' ? 'That budget is too large.' : field === 'people' ? 'That headcount is too large.' : issue.message;
    }
  }
  return { ok: false, errors: Object.keys(out).length ? out : { name: 'Check the event details.' } };
}
