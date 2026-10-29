import { Link } from 'react-router-dom';
import { demoTasks, EVENT_DAY } from '../plan/demoPlan';
import { StatusBadge, type Status } from '../ui/StatusBadge';

// A read-only glance at the plan: every task as a bar on one time axis, event day marked. The full
// Bryntum Gantt stays on the Plan screen, so Event home does not carry its large bundle.
const START = Date.parse('2027-01-04T00:00:00Z');
const END = Date.parse('2027-03-28T00:00:00Z');
const DAY = 86_400_000;

function position(startDate: string, duration: number) {
  const span = END - START;
  const left = ((Date.parse(`${startDate}T00:00:00Z`) - START) / span) * 100;
  const width = Math.max((duration * DAY) / span * 100, 1.2);
  return { left: `${left}%`, width: `${width}%` };
}

export function RunwayStrip() {
  const eventLeft = ((Date.parse(`${EVENT_DAY}T00:00:00Z`) - START) / (END - START)) * 100;
  const atRisk = demoTasks.filter((t) => t.status === 'blocked' || t.status === 'risk').length;
  return (
    <section className="card runway" aria-label="Plan runway">
      <div className="runway-head">
        <h2>Plan runway</h2>
        <Link to="/plan">Open the plan</Link>
      </div>
      <div className="runway-track" role="img" aria-label={`${demoTasks.length} tasks, ${atRisk} waiting or at risk, event day Mar 14`}>
        {demoTasks
          .filter((t) => t.duration && t.duration > 0)
          .map((t, index) => (
            <span
              key={String(t.id)}
              className={`runway-bar runway-bar--${t.status as Status}`}
              style={{ ...position(String(t.startDate), Number(t.duration)), top: `${index * 14}px` }}
              title={String(t.name)}
            />
          ))}
        <span className="runway-event" style={{ left: `${eventLeft}%` }}>
          <span className="runway-event-label">Event day</span>
        </span>
      </div>
      <div className="badge-row">
        <StatusBadge status="done" />
        <StatusBadge status="progress" />
        <StatusBadge status="blocked" label="Waiting on sponsor payment" />
      </div>
    </section>
  );
}
