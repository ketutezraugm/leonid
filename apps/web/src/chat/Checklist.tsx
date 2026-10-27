import type { ChecklistItem } from '@quartermaster/shared';

const marks: Record<ChecklistItem['status'], { symbol: string; label: string }> = {
  pending: { symbol: '○', label: 'To do' },
  in_progress: { symbol: '◐', label: 'In progress' },
  done: { symbol: '✓', label: 'Done' },
  blocked: { symbol: '⏸', label: 'Blocked' },
};

export function Checklist({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) return null;
  return (
    <aside className="chat-checklist" aria-label="Agent checklist">
      <h3>Checklist</h3>
      <ul>
        {items.map((item, index) => (
          <li key={index} className={`chat-checklist-item chat-checklist-item--${item.status}`}>
            <span aria-hidden="true">{marks[item.status].symbol}</span>
            <span className="visually-hidden">{marks[item.status].label}: </span>
            <span>
              {item.title}
              {item.blockedOn && <em> (waiting on {item.blockedOn})</em>}
              {item.note && <small>{item.note}</small>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
