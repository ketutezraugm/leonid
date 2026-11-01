import { Link } from 'react-router-dom';
import { useEventPath } from '../shell/event';
import { demoTasks, EVENT_DAY } from '../plan/demoPlan';
import { StatusBadge, type Status } from '../ui/StatusBadge';

// A read-only glance at the plan on one time axis: month ticks, every task as a bar, event day in brass.
// The full Bryntum Gantt stays on the Plan screen, so Event home does not carry its large bundle.
const START = Date.parse('2027-01-04T00:00:00Z');
const END = Date.parse('2027-03-28T00:00:00Z');
const DAY = 86_400_000;

const at = (iso: string) => ((Date.parse(`${iso}T00:00:00Z`) - START) / (END - START)) * 100;

const MONTHS = [
  { label: 'Jan', date: '2027-01-04' },
  { label: 'Feb', date: '2027-02-01' },
  { label: 'Mar', date: '2027-03-01' },
];

const statusLabel: Record<Status, string> = {
  done: 'done',
  progress: 'in progress',
  pending: 'not started',
  risk: 'at risk',
  blocked: 'waiting on sponsor payment',
};

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

export function RunwayStrip() {
  const path = useEventPath();
  const bars = demoTasks.filter((t) => Number(t.duration) > 0);
  const flagged = bars.filter((t) => t.status === 'blocked' || t.status === 'risk');
  const next = bars.filter((t) => t.status !== 'done').slice(0, 2);

  return (
    <section className="runway" aria-labelledby="runway-title">
      <div className="runway-head">
        <h2 id="runway-title">Plan</h2>
        <p className="muted">
          {flagged.length > 0 ? `${flagged.length} tasks waiting or at risk` : 'Everything is on track'}
          {' · '}
          Next: {next.map((t) => String(t.name)).join(', ')}
        </p>
        <Link to={path('plan')}>Open the plan</Link>
      </div>

      <div className="runway-track" aria-hidden="true">
        {MONTHS.map((m) => (
          <span key={m.label} className="runway-month" style={{ left: `${at(m.date)}%` }}>
            {m.label}
          </span>
        ))}
        {bars.map((t, index) => (
          <span
            key={String(t.id)}
            className={`runway-bar runway-bar--${t.status as Status}`}
            style={{
              left: `${at(String(t.startDate))}%`,
              width: `${Math.max(((Number(t.duration) * DAY) / (END - START)) * 100, 1.2)}%`,
              top: `${22 + index * 10}px`,
            }}
            title={`${String(t.name)}: ${statusLabel[t.status as Status]}`}
          />
        ))}
        <span className="runway-event" style={{ left: `${at(EVENT_DAY)}%` }}>
          <span className="runway-event-label">Event day</span>
        </span>
      </div>

      {/* The bars are drawn for sight; this list carries the same plan for screen readers. */}
      <ul className="visually-hidden">
        {bars.map((t) => (
          <li key={String(t.id)}>
            {String(t.name)}, from {shortDate(String(t.startDate))}, {statusLabel[t.status as Status]}
          </li>
        ))}
        <li>Event day, {shortDate(EVENT_DAY)}</li>
      </ul>

      <div className="badge-row">
        <StatusBadge status="done" />
        <StatusBadge status="progress" />
        <StatusBadge status="pending" />
        <StatusBadge status="blocked" label="Waiting on sponsor payment" />
      </div>
    </section>
  );
}
