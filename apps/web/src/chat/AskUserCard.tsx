import { useState, type FormEvent } from 'react';
import type { AskUserInput } from '@quartermaster/shared';

const OTHER_MAX_LENGTH = 300;

interface Answer {
  picked: string[];
  other: string;
  otherOn: boolean;
}

const empty: Answer = { picked: [], other: '', otherOn: false };

function valuesOf(answer: Answer): string[] {
  const other = answer.other.trim();
  return [...answer.picked, ...(answer.otherOn && other ? [other] : [])];
}

// The agent's clarifying questions as choices. Each question takes one option (or several when
// multiSelect), or the organizer's own words. All answers go back as one user message.
export function AskUserCard({
  input,
  active,
  onAnswer,
}: {
  input: AskUserInput;
  // False once the conversation has moved on or a run is in progress.
  active: boolean;
  onAnswer: (text: string) => void;
}) {
  const [answers, setAnswers] = useState<Answer[]>(() => input.questions.map(() => empty));
  const complete = answers.every((a) => valuesOf(a).length > 0);

  function update(index: number, change: (answer: Answer) => Answer) {
    setAnswers((current) => current.map((a, i) => (i === index ? change(a) : a)));
  }

  function pick(index: number, label: string, multi: boolean) {
    update(index, (a) =>
      multi
        ? {
            ...a,
            picked: a.picked.includes(label)
              ? a.picked.filter((p) => p !== label)
              : [...a.picked, label],
          }
        : { ...a, picked: [label], otherOn: false },
    );
  }

  function toggleOther(index: number, multi: boolean) {
    update(index, (a) =>
      multi ? { ...a, otherOn: !a.otherOn } : { ...a, picked: [], otherOn: true },
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!active || !complete) return;
    onAnswer(
      input.questions
        .map((q, i) => `${q.header}: ${valuesOf(answers[i] ?? empty).join(', ')}`)
        .join('\n'),
    );
  }

  return (
    <form className="ask-user" onSubmit={onSubmit} aria-label="Questions from Quartermaster">
      {input.questions.map((q, i) => {
        const answer = answers[i] ?? empty;
        return (
          <fieldset key={i} className="ask-user-question" disabled={!active}>
            <legend>
              <span className="ask-user-header">{q.header}</span>
              {q.question}
              {q.multiSelect && <span className="muted"> (pick any)</span>}
            </legend>
            <div className="ask-user-options">
              {q.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={answer.picked.includes(option.label)}
                  onClick={() => pick(i, option.label, q.multiSelect)}
                >
                  <strong>{option.label}</strong>
                  {option.description && <span>{option.description}</span>}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={answer.otherOn}
                onClick={() => toggleOther(i, q.multiSelect)}
              >
                <strong>Other</strong>
                <span>Write your own answer</span>
              </button>
            </div>
            {answer.otherOn && (
              <input
                aria-label={`Your answer: ${q.header}`}
                placeholder="Type your answer"
                maxLength={OTHER_MAX_LENGTH}
                value={answer.other}
                autoFocus
                onChange={(e) => update(i, (a) => ({ ...a, other: e.target.value }))}
              />
            )}
          </fieldset>
        );
      })}
      {active && (
        <button type="submit" className="ask-user-submit" disabled={!complete}>
          Send answers
        </button>
      )}
    </form>
  );
}
