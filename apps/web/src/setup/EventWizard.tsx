import { BOOKING_ITEMS, EventSummary, type BookingItemId } from '@quartermaster/shared';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadIds, newThreadId, saveActiveId, saveIds, saveKickoff, withId } from '../chat/sessions';
import { ApiFailure, errorMessage, sendJson } from '../shell/api';
import { eventPath, rememberEvent, useEvents } from '../shell/event';
import { Button } from '../ui/Button';
import { parseMoneyInput } from '../ui/money';
import {
  answers,
  budgetLabel,
  CITIES,
  defaultNeeds,
  DURATIONS,
  EVENT_KINDS,
  kickoffText,
  kindOf,
  newBrief,
  PARTS,
  QUESTIONS,
  VENUE_STATUSES,
  type Brief,
  type EventKindId,
  type QuestionId,
} from './eventBrief';

// How long the "setting up" summary stays up at least, so the organizer sees their answers land.
export const BUILDING_MIN_MS = 600;

type Phase = 'kind' | 'intro' | 'questions' | 'building';

export function EventWizard() {
  const [phase, setPhase] = useState<Phase>('kind');
  const [kind, setKind] = useState<EventKindId | null>(null);
  const [kindNote, setKindNote] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();

  // Esc closes the popup, like the ×; not while the event is being saved.
  useEffect(() => {
    if (phase === 'building') return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') navigate('/events');
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, navigate]);

  if (phase === 'kind' || !brief) {
    return (
      <KindPicker
        kind={kind}
        note={kindNote}
        onKind={setKind}
        onNote={setKindNote}
        onContinue={() => {
          if (!kind) return;
          // A different kind brings its own defaults; the same kind keeps what was answered.
          setBrief((current) =>
            current?.kind === kind
              ? { ...current, kindNote: kindNote.trim() }
              : newBrief(kind, kindNote),
          );
          setPhase('intro');
        }}
      />
    );
  }

  if (phase === 'intro') {
    return (
      <Panel onBack={() => setPhase('kind')}>
        <Orb />
        <h1 className="interview-title">
          Let’s set up your {kindOf(brief.kind).label.toLowerCase()}
        </h1>
        <p className="interview-lead">
          I’ll ask {QUESTIONS.length} quick questions in {PARTS.length} parts. Then the agent starts
          researching, and nothing is bought without your rules. Ready?
        </p>
        <Button variant="primary" onClick={() => setPhase('questions')} autoFocus>
          I’m ready
        </Button>
      </Panel>
    );
  }

  if (phase === 'building') {
    return (
      <Building
        brief={brief}
        onEdit={() => {
          setIndex(QUESTIONS.length - 1);
          setPhase('questions');
        }}
      />
    );
  }

  const question = QUESTIONS[index]!;
  const answered = (i: number) => isAnswered(brief, QUESTIONS[i]!.id) || !QUESTIONS[i]!.required;
  return (
    <Panel onBack={() => (index === 0 ? setPhase('intro') : setIndex(index - 1))}>
      <Orb small />
      <h1 className="interview-title">
        Part {PART_WORDS[question.part]}: {PARTS[question.part]!.title.toLowerCase()}
      </h1>
      <QuestionCard
        key={question.id}
        brief={brief}
        id={question.id}
        onPrev={index > 0 ? () => setIndex(index - 1) : null}
        onNext={index < QUESTIONS.length - 1 && answered(index) ? () => setIndex(index + 1) : null}
        onAnswer={(next) => {
          setBrief(next);
          if (index === QUESTIONS.length - 1) setPhase('building');
          else setIndex(index + 1);
        }}
      />
    </Panel>
  );
}

const PART_WORDS = ['one', 'two', 'three', 'four'];

function isAnswered(brief: Brief, id: QuestionId): boolean {
  if (id === 'name') return brief.name.trim() !== '';
  if (id === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(brief.date);
  if (id === 'people') return brief.people !== null;
  if (id === 'budget') return brief.budget !== null;
  return true;
}

function Panel({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  return (
    <div className="interview">
      <section className="interview-panel" role="dialog" aria-modal="true" aria-label="New event">
        <div className="interview-top">
          {onBack ? (
            <button type="button" className="interview-back" onClick={onBack}>
              ‹ Back
            </button>
          ) : (
            <span />
          )}
          <Link to="/events" className="interview-close" aria-label="Cancel and go to all events">
            ×
          </Link>
        </div>
        {children}
      </section>
    </div>
  );
}

function Orb({ small = false }: { small?: boolean }) {
  return (
    <div className={`interview-orb${small ? ' interview-orb--small' : ''}`} aria-hidden="true" />
  );
}

// --- Step 1: what kind of event --------------------------------------------------------------

function KindPicker({
  kind,
  note,
  onKind,
  onNote,
  onContinue,
}: {
  kind: EventKindId | null;
  note: string;
  onKind: (kind: EventKindId) => void;
  onNote: (note: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="interview">
      <section
        className="interview-panel interview-panel--wide"
        role="dialog"
        aria-modal="true"
        aria-label="New event"
      >
        <div className="interview-top">
          <span />
          <Link to="/events" className="interview-close" aria-label="Cancel and go to all events">
            ×
          </Link>
        </div>
        <h1 className="interview-title">What kind of event are you running?</h1>
        <p className="interview-lead">
          Pick the closest one. It sets sensible defaults; you can change every answer.
        </p>
        <div className="kind-grid">
          {EVENT_KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="kind-card"
              aria-pressed={kind === option.id}
              onClick={() => onKind(option.id)}
            >
              <KindScene kind={option.id} />
              <span className="kind-card-label">{option.label}</span>
              <span className="kind-card-size">{option.size}</span>
              <span className="kind-card-blurb">{option.blurb}</span>
            </button>
          ))}
        </div>
        {kind === 'other' && (
          <div className="field interview-field">
            <label htmlFor="kind-note">What is it, in a few words?</label>
            <input
              id="kind-note"
              value={note}
              maxLength={200}
              autoFocus
              placeholder="A design jam with a pitch session at the end"
              onChange={(e) => onNote(e.target.value)}
            />
          </div>
        )}
        <Button
          variant="primary"
          className="interview-continue"
          disabled={!kind}
          onClick={onContinue}
        >
          Continue
        </Button>
      </section>
    </div>
  );
}

// A small drawing of the room at each size: seats as dots, a stage as a bar. Decorative.
function KindScene({ kind }: { kind: EventKindId }) {
  const dots = (cols: number, rows: number, x0: number, y0: number, gap: number, r: number) =>
    Array.from({ length: cols * rows }, (_, i) => (
      <circle
        key={`${x0}-${i}`}
        cx={x0 + (i % cols) * gap}
        cy={y0 + Math.floor(i / cols) * gap}
        r={r}
      />
    ));
  const scenes: Record<EventKindId, ReactNode> = {
    meetup: (
      <>
        <rect className="scene-fixture" x="44" y="22" width="32" height="20" rx="4" />
        {[
          [36, 16],
          [60, 12],
          [84, 16],
          [36, 48],
          [60, 52],
          [84, 48],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />
        ))}
      </>
    ),
    hackathon: (
      <>
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3].map((col) => (
            <g key={`${row}-${col}`}>
              <rect
                className="scene-fixture"
                x={16 + col * 24}
                y={8 + row * 18}
                width="16"
                height="7"
                rx="2"
              />
              <circle cx={24 + col * 24} cy={19 + row * 18} r="2.5" />
            </g>
          )),
        )}
      </>
    ),
    stage: (
      <>
        <rect className="scene-stage" x="30" y="6" width="60" height="8" rx="2" />
        {dots(9, 4, 20, 26, 10, 2.5)}
      </>
    ),
    conference: (
      <>
        <rect className="scene-stage" x="6" y="6" width="30" height="6" rx="2" />
        <rect className="scene-stage" x="45" y="6" width="30" height="6" rx="2" />
        <rect className="scene-stage" x="84" y="6" width="30" height="6" rx="2" />
        {dots(14, 5, 8, 22, 8, 2)}
      </>
    ),
    other: (
      <>
        <circle className="scene-dashed" cx="60" cy="32" r="18" />
        <path className="scene-plus" d="M60 24v16M52 32h16" />
      </>
    ),
  };
  return (
    <svg className="kind-scene" viewBox="0 0 120 64" aria-hidden="true">
      {scenes[kind]}
    </svg>
  );
}

// --- Step 2: the questions -------------------------------------------------------------------

interface Option {
  key: string;
  label: string;
  hint?: string;
}

function QuestionCard({
  brief,
  id,
  onPrev,
  onNext,
  onAnswer,
}: {
  brief: Brief;
  id: QuestionId;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onAnswer: (brief: Brief) => void;
}) {
  const question = QUESTIONS.find((q) => q.id === id)!;
  const kind = kindOf(brief.kind);
  const [text, setText] = useState(() => initialText(brief, id));
  const [choice, setChoice] = useState<string | null>(() => initialChoice(brief, id));
  const [needs, setNeeds] = useState<BookingItemId[]>(brief.needs);
  const [error, setError] = useState<string | null>(null);
  const otherRef = useRef<HTMLInputElement>(null);

  const options: Option[] | null =
    id === 'duration'
      ? DURATIONS.map((d) => ({ key: d.id, label: d.label }))
      : id === 'people'
        ? kind.people.map((n) => ({ key: String(n), label: `${n} people` }))
        : id === 'city'
          ? CITIES.map((c) => ({ key: c, label: c }))
          : id === 'venue'
            ? VENUE_STATUSES.map((v) => ({
                key: v.id,
                label: v.label,
                hint:
                  v.id === 'find' ? 'The venue scout searches listings in your city' : undefined,
              }))
            : id === 'budget'
              ? kind.budgets.map((b) => ({ key: String(b), label: budgetLabel(b) }))
              : null;
  const hasOther = id === 'people' || id === 'city' || id === 'budget';

  useEffect(() => {
    if (choice === 'other') otherRef.current?.focus();
  }, [choice]);

  function confirm() {
    const next = resolve(brief, id, { text, choice, needs });
    if (typeof next === 'string') {
      setError(next);
      return;
    }
    onAnswer(next);
  }

  function skip() {
    onAnswer(brief);
  }

  // A–D pick an option, like the letters beside them; typing in a box is left alone.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      }
      return;
    }
    if (!options || e.metaKey || e.ctrlKey || e.altKey) return;
    const at = e.key.toLowerCase().charCodeAt(0) - 97;
    if (e.key.length !== 1 || at < 0) return;
    if (at < options.length) setChoice(options[at]!.key);
    else if (hasOther && at === options.length) setChoice('other');
  }

  return (
    <div className="question-card" onKeyDown={onKeyDown}>
      <div className="question-head">
        <span className="question-part">{PARTS[question.part]!.title}</span>
        <span className="question-count">
          <button
            type="button"
            aria-label="Previous question"
            disabled={!onPrev}
            onClick={onPrev ?? undefined}
          >
            ‹
          </button>
          {question.index + 1} of {question.count}
          <button
            type="button"
            aria-label="Next question"
            disabled={!onNext}
            onClick={onNext ?? undefined}
          >
            ›
          </button>
        </span>
      </div>
      <h2 className="question-text" id={`q-${id}`}>
        {question.text}
      </h2>

      {(id === 'name' || id === 'date') && (
        <input
          className="question-input"
          aria-labelledby={`q-${id}`}
          aria-invalid={error ? true : undefined}
          type={id === 'date' ? 'date' : 'text'}
          value={text}
          maxLength={120}
          autoFocus
          autoComplete="off"
          placeholder={id === 'name' ? 'OpenHack 2027' : undefined}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {options && (
        <div className="question-options" role="radiogroup" aria-labelledby={`q-${id}`}>
          {options.map((option, i) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={choice === option.key}
              autoFocus={i === 0 && choice === null}
              onClick={() => setChoice(option.key)}
              onDoubleClick={() => {
                const next = resolve(brief, id, { text, choice: option.key, needs });
                if (typeof next !== 'string') onAnswer(next);
              }}
            >
              <span className="question-letter">{String.fromCharCode(65 + i)}</span>
              <span>
                {option.label}
                {option.hint && <span className="question-hint">{option.hint}</span>}
              </span>
            </button>
          ))}
          {hasOther && (
            <div className="question-other" data-active={choice === 'other' || undefined}>
              <button
                type="button"
                role="radio"
                aria-checked={choice === 'other'}
                onClick={() => setChoice('other')}
              >
                <span className="question-letter">{String.fromCharCode(65 + options.length)}</span>
                {choice !== 'other' && <span className="muted">Other…</span>}
              </button>
              {choice === 'other' && (
                <input
                  ref={otherRef}
                  aria-label={
                    id === 'people'
                      ? 'Number of people'
                      : id === 'budget'
                        ? 'Budget in US dollars'
                        : 'City'
                  }
                  aria-invalid={error ? true : undefined}
                  inputMode={id === 'city' ? 'text' : id === 'people' ? 'numeric' : 'decimal'}
                  value={text}
                  maxLength={80}
                  placeholder={id === 'people' ? '250' : id === 'budget' ? '8,000' : 'Bandung'}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {id === 'needs' && (
        <>
          <div className="question-needs" role="group" aria-labelledby={`q-${id}`}>
            {BOOKING_ITEMS.map((item) => (
              <label key={item.id} className="question-need">
                <input
                  type="checkbox"
                  checked={needs.includes(item.id)}
                  onChange={(e) =>
                    setNeeds(
                      e.target.checked
                        ? BOOKING_ITEMS.map((i) => i.id).filter(
                            (i) => i === item.id || needs.includes(i),
                          )
                        : needs.filter((n) => n !== item.id),
                    )
                  }
                />
                <span>
                  <strong>{item.label}</strong>
                  <span className="question-hint">
                    {item.description}
                    {!item.available && ' · agent help coming soon'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <input
            className="question-input"
            aria-label="Anything else you need"
            value={text}
            maxLength={300}
            placeholder="Anything else? A first-aid kit, a sign-language interpreter…"
            onChange={(e) => setText(e.target.value)}
          />
        </>
      )}

      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="question-actions">
        {!question.required && <Button onClick={skip}>Skip</Button>}
        <Button variant="primary" onClick={confirm}>
          Confirm ↵
        </Button>
      </div>
    </div>
  );
}

function initialText(brief: Brief, id: QuestionId): string {
  if (id === 'name') return brief.name;
  if (id === 'date') return brief.date;
  if (id === 'needs') return brief.needsNote;
  if (id === 'people' && brief.people && !kindOf(brief.kind).people.includes(brief.people))
    return String(brief.people);
  if (id === 'budget' && brief.budget && !kindOf(brief.kind).budgets.includes(brief.budget))
    return budgetLabel(brief.budget).replace('$', '');
  if (id === 'city' && brief.city && !(CITIES as readonly string[]).includes(brief.city))
    return brief.city;
  return '';
}

function initialChoice(brief: Brief, id: QuestionId): string | null {
  const kind = kindOf(brief.kind);
  if (id === 'duration') return brief.duration;
  if (id === 'venue') return brief.venue;
  if (id === 'people' && brief.people)
    return kind.people.includes(brief.people) ? String(brief.people) : 'other';
  if (id === 'budget' && brief.budget)
    return kind.budgets.includes(brief.budget) ? String(brief.budget) : 'other';
  if (id === 'city' && brief.city)
    return (CITIES as readonly string[]).includes(brief.city) ? brief.city : 'other';
  return null;
}

// The brief with this answer in it, or what is wrong with the answer.
function resolve(
  brief: Brief,
  id: QuestionId,
  { text, choice, needs }: { text: string; choice: string | null; needs: BookingItemId[] },
): Brief | string {
  switch (id) {
    case 'name':
      return text.trim() ? { ...brief, name: text.trim() } : 'Give the event a name.';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? { ...brief, date: text }
        : 'Pick the day it starts.';
    case 'duration':
      return { ...brief, duration: (DURATIONS.find((d) => d.id === choice) ?? DURATIONS[1]!).id };
    case 'people': {
      const people = Number(choice === 'other' ? text.trim() : choice);
      return Number.isInteger(people) && people >= 1
        ? { ...brief, people }
        : choice === 'other'
          ? 'How many people? A whole number, 1 or more.'
          : 'Pick how many people are coming.';
    }
    case 'city': {
      const city = choice === 'other' ? text.trim() : (choice ?? '');
      return { ...brief, city };
    }
    case 'venue': {
      const venue = VENUE_STATUSES.find((v) => v.id === choice)?.id ?? 'find';
      // A new venue answer resets the pre-ticked list, since only "find me one" includes the venue.
      return venue === brief.venue
        ? brief
        : { ...brief, venue, needs: defaultNeeds(brief.kind, venue) };
    }
    case 'needs':
      return { ...brief, needs, needsNote: text.trim() };
    case 'budget': {
      const budget = choice === 'other' ? parseMoneyInput(text) : Number(choice);
      return budget && Number.isSafeInteger(budget) && budget > 0
        ? { ...brief, budget }
        : choice === 'other'
          ? 'Enter the budget in dollars, like 8,000.'
          : 'Pick the total budget.';
    }
  }
}

// --- Step 3: save the event and hand over to the agent ----------------------------------------

function Building({ brief, onEdit }: { brief: Brief; onEdit: () => void }) {
  const navigate = useNavigate();
  const { refresh } = useEvents();
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One POST per attempt, even when React runs the effect twice in development; a remount must
  // not create a second event.
  const posted = useRef(-1);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (posted.current === attempt) return;
    posted.current = attempt;
    const started = Date.now();
    sendJson('/api/events', EventSummary, {
      name: brief.name,
      date: brief.date,
      people: brief.people,
      budget: brief.budget,
      currency: 'USD',
    })
      .then((created) => {
        rememberEvent(created.id);
        refresh();
        // A fresh chat for this event, opened as the active one; it sends the answers itself.
        const threadId = newThreadId();
        saveActiveId(threadId);
        saveIds(withId(loadIds(), threadId));
        saveKickoff({
          threadId,
          eventId: created.id,
          eventName: created.name,
          text: kickoffText(brief),
        });
        const wait = Math.max(0, BUILDING_MIN_MS - (Date.now() - started));
        setTimeout(() => mounted.current && navigate(eventPath(created.id, 'agent')), wait);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        if (err instanceof ApiFailure && err.status === 401) setProblem('signin');
        else if (err instanceof ApiFailure && err.status === 422)
          setProblem('Check your answers and try again.');
        else if (err instanceof ApiFailure && err.status !== 500) {
          const { title, detail } = errorMessage(err);
          setProblem(`${title}. ${detail}`);
        } else setProblem("Couldn't save the event. Try again.");
      });
  }, [attempt, brief, navigate, refresh]);

  return (
    <Panel onBack={problem ? onEdit : undefined}>
      <Orb />
      {problem ? (
        <div role="alert" className="interview-problem">
          {problem === 'signin' ? (
            <p>
              Your session expired. <Link to="/signin">Sign in</Link> to create the event.
            </p>
          ) : (
            <p>{problem}</p>
          )}
          <div className="btn-row">
            <Button
              variant="primary"
              onClick={() => {
                setProblem(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
            <Button onClick={onEdit}>Change answers</Button>
          </div>
        </div>
      ) : (
        <p className="interview-status" role="status">
          <span className="interview-spinner" aria-hidden="true" /> Setting up {brief.name}…
        </p>
      )}
      <ul className="answer-list">
        {answers(brief).map(({ question, answer }) => (
          <li key={question}>
            <strong>{question}</strong>
            <span>{answer}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
