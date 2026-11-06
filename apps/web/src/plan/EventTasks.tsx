import { Link } from 'react-router-dom';
import { EventOverview } from '@quartermaster/shared';
import { errorMessage, useFetch } from '../shell/api';
import { formatEventDate, useEventPath } from '../shell/event';
import { PageState } from '../ui/PageState';

// The plan of an event the person made: the tasks the planning agent wrote for it, as a plain list. The Bryntum Gantt
// shows the demo plan only; it has no per-event data or task status yet, so this is read-only and says so.
export function EventTasks({ eventId }: { eventId: string }) {
  const path = useEventPath();
  const overview = useFetch(`/api/events/${encodeURIComponent(eventId)}/overview`, EventOverview);

  if (overview.kind === 'loading') return <PageState kind="loading" title="Loading the plan…" />;
  if (overview.kind === 'error') {
    const { title, detail } = errorMessage(overview.error);
    return (
      <PageState kind="error" title={title} onRetry={overview.reload}>
        {detail}
      </PageState>
    );
  }

  const { tasks } = overview.data;
  if (tasks.length === 0) {
    return (
      <PageState kind="empty" title="No tasks yet">
        Ask the agent to plan this event and its tasks will appear here. <Link to={path('/agent')}>Open the agent</Link>
      </PageState>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="muted">Tasks the agent planned, by start date.</caption>
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Starts</th>
            <th scope="col">Ends</th>
            <th scope="col">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <th scope="row">{t.name}</th>
              <td className="num">{formatEventDate(t.start)}</td>
              <td className="num">{formatEventDate(t.end)}</td>
              <td className="num">{t.deadline ? formatEventDate(t.deadline) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
