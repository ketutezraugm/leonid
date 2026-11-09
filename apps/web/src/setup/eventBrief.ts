import { BOOKING_ITEMS, bookingChoiceText, type BookingItemId } from '@leonid/shared';
import { formatMoney } from '../ui/money';

// The event setup interview (screen 2): the organizer picks what kind of event it is, answers eight
// short questions in four parts, and the answers become the agent's first message. Only name, date,
// headcount and budget are saved on the event; the rest lives in that message, where the agent reads it.

export type EventKindId = 'meetup' | 'hackathon' | 'stage' | 'conference' | 'other';

export interface EventKind {
  id: EventKindId;
  label: string;
  size: string;
  blurb: string;
  // Phrase for the agent's first message: "a hackathon for 200 people".
  phrase: string;
  people: readonly number[];
  budgets: readonly number[]; // minor units
  needs: readonly BookingItemId[];
  duration: DurationId;
}

export const EVENT_KINDS: readonly EventKind[] = [
  {
    id: 'meetup',
    label: 'Meetup or small gathering',
    size: '5–50 people',
    blurb: 'A community night or a team meeting. One room, snacks, maybe a screen.',
    phrase: 'a meetup',
    people: [20, 40, 60],
    budgets: [50_000, 150_000, 300_000],
    needs: ['venue', 'catering'],
    duration: 'hours',
  },
  {
    id: 'hackathon',
    label: 'Workshop or hackathon',
    size: '20–200 people',
    blurb: 'Long hours of building. Tables, power, Wi-Fi, meals and prizes.',
    phrase: 'a hackathon',
    people: [50, 100, 200],
    budgets: [300_000, 800_000, 1_500_000],
    needs: ['venue', 'catering', 'av', 'swag', 'prizes'],
    duration: 'day',
  },
  {
    id: 'stage',
    label: 'Stage event',
    size: '50–300 people',
    blurb: 'Talks on one stage, a mini-conference. A hall with AV, speakers and catering.',
    phrase: 'a stage event with talks',
    people: [80, 150, 300],
    budgets: [500_000, 1_200_000, 2_500_000],
    needs: ['venue', 'catering', 'av', 'speakers', 'printing'],
    duration: 'day',
  },
  {
    id: 'conference',
    label: 'Conference or festival',
    size: '300+ people',
    blurb: 'Several stages or tracks, booths, badges, staff and more sponsors.',
    phrase: 'a conference',
    people: [300, 600, 1000],
    budgets: [2_000_000, 5_000_000, 10_000_000],
    needs: ['venue', 'catering', 'av', 'swag', 'speakers', 'printing', 'photography'],
    duration: 'two-days',
  },
  {
    id: 'other',
    label: 'Something else',
    size: 'Any size',
    blurb: 'Tell me in a few words and I’ll ask the rest.',
    phrase: 'an event',
    people: [30, 100, 300],
    budgets: [100_000, 500_000, 1_500_000],
    needs: ['venue'],
    duration: 'day',
  },
];

export const kindOf = (id: EventKindId): EventKind =>
  EVENT_KINDS.find((kind) => kind.id === id) ?? EVENT_KINDS[0]!;

export type DurationId = 'hours' | 'day' | 'two-days' | 'overnight';
export const DURATIONS: readonly { id: DurationId; label: string }[] = [
  { id: 'hours', label: 'A few hours' },
  { id: 'day', label: 'A full day' },
  { id: 'two-days', label: 'Two days' },
  { id: 'overnight', label: 'Overnight' },
];

// The cities the seeded venue listings cover, so "find me one" always has results to show.
export const CITIES = ['Jakarta', 'Kuala Lumpur', 'Singapore'] as const;

export type VenueStatus = 'find' | 'have' | 'online';
export const VENUE_STATUSES: readonly { id: VenueStatus; label: string }[] = [
  { id: 'find', label: 'Find me one' },
  { id: 'have', label: 'I already have one' },
  { id: 'online', label: 'Online or hybrid' },
];

export interface Brief {
  kind: EventKindId;
  kindNote: string;
  name: string;
  date: string; // YYYY-MM-DD
  duration: DurationId;
  people: number | null;
  city: string;
  venue: VenueStatus;
  needs: BookingItemId[];
  needsNote: string;
  budget: number | null; // minor units, USD
}

export function newBrief(kind: EventKindId, kindNote = ''): Brief {
  const k = kindOf(kind);
  return {
    kind,
    kindNote: kindNote.trim(),
    name: '',
    date: '',
    duration: k.duration,
    people: null,
    city: '',
    venue: 'find',
    needs: defaultNeeds(kind, 'find'),
    needsNote: '',
    budget: null,
  };
}

// What usually fits this kind of event; the venue is only pre-ticked when the agent has to find one.
export function defaultNeeds(kind: EventKindId, venue: VenueStatus): BookingItemId[] {
  const needs = kindOf(kind).needs;
  return BOOKING_ITEMS.filter((item) => item.available)
    .map((item) => item.id)
    .filter((id) => needs.includes(id) && (id !== 'venue' || venue === 'find'));
}

export type QuestionId =
  'name' | 'date' | 'duration' | 'people' | 'city' | 'venue' | 'needs' | 'budget';

export interface Part {
  title: string;
  questions: readonly { id: QuestionId; text: string; required: boolean }[];
}

export const PARTS: readonly Part[] = [
  {
    title: 'The basics',
    questions: [
      { id: 'name', text: 'What’s the event called?', required: true },
      { id: 'date', text: 'Which day does it start?', required: true },
      { id: 'duration', text: 'How long does it run?', required: false },
      { id: 'people', text: 'How many people are coming?', required: true },
    ],
  },
  {
    title: 'Where',
    questions: [
      { id: 'city', text: 'Which city is it in?', required: false },
      { id: 'venue', text: 'Do you have a venue yet?', required: false },
    ],
  },
  {
    title: 'What you need',
    questions: [{ id: 'needs', text: 'What should I help you book?', required: false }],
  },
  {
    title: 'Money',
    questions: [{ id: 'budget', text: 'What’s the total budget?', required: true }],
  },
];

export const QUESTIONS = PARTS.flatMap((part, partIndex) =>
  part.questions.map((question, index) => ({
    ...question,
    part: partIndex,
    index,
    count: part.questions.length,
  })),
);

export function budgetLabel(minor: number): string {
  return formatMoney(minor, 'USD').replace(/\.00$/, '');
}

export function longDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const labelOf = <T extends string>(list: readonly { id: T; label: string }[], id: T) =>
  list.find((item) => item.id === id)?.label ?? id;

// Each question with the organizer's answer, for the "building your plan" summary.
export function answers(brief: Brief): { question: string; answer: string }[] {
  const needs = BOOKING_ITEMS.filter((item) => brief.needs.includes(item.id)).map((i) => i.label);
  const answer: Record<QuestionId, string> = {
    name: brief.name,
    date: brief.date ? longDate(brief.date) : '',
    duration: labelOf(DURATIONS, brief.duration),
    people: brief.people ? String(brief.people) : '',
    city: brief.city || 'Not decided yet',
    venue: labelOf(VENUE_STATUSES, brief.venue),
    needs: [...needs, brief.needsNote.trim()].filter(Boolean).join(', ') || 'Nothing yet',
    budget: brief.budget ? budgetLabel(brief.budget) : '',
  };
  return [
    { question: 'What kind of event?', answer: brief.kindNote || kindOf(brief.kind).label },
    ...QUESTIONS.map((q) => ({ question: q.text, answer: answer[q.id] })),
  ];
}

const venueLine: Record<VenueStatus, string> = {
  find: 'I still need a venue, so find me one.',
  have: 'I already have a venue, so do not search for one.',
  online: 'It is online or hybrid, so no venue search for now.',
};

// The agent's first message. The booking lines use the shared format, so the server reads the
// organizer's choice from it and the agent skips asking what to book.
export function kickoffText(brief: Brief): string {
  const kind = kindOf(brief.kind);
  const where = brief.city ? `in ${brief.city}` : 'in a city I have not decided yet';
  const when = brief.date ? `on ${longDate(brief.date)}` : '';
  const duration = labelOf(DURATIONS, brief.duration).toLowerCase();
  return [
    `Plan our new event, ${brief.name.trim()}: ` +
      [kind.phrase, `for ${brief.people ?? 'some'} people`, where, when, `(${duration}).`]
        .filter(Boolean)
        .join(' '),
    brief.kindNote && `About the event: ${brief.kindNote}`,
    brief.budget && `Total budget: ${budgetLabel(brief.budget)}.`,
    venueLine[brief.venue],
    'Start with what you can do now, then tell me the next step.',
    bookingChoiceText({ chosen: brief.needs, extra: brief.needsNote.trim().slice(0, 300) || null }),
  ]
    .filter(Boolean)
    .join('\n');
}
