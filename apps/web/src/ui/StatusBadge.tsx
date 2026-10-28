// One status vocabulary for tasks, spends, claims and payouts, so a blocked
// Gantt task and a blocked spend look identical (colors in tokens.css).
export type Status = 'done' | 'progress' | 'pending' | 'risk' | 'blocked';

const defaultLabels: Record<Status, string> = {
  done: 'Done',
  progress: 'In progress',
  pending: 'Not started',
  risk: 'At risk',
  blocked: 'Blocked',
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  return <span className={`badge badge-${status}`}>{label ?? defaultLabels[status]}</span>;
}
