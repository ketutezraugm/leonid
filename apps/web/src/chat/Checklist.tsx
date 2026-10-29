import { useId, useState } from 'react';
import type { ChecklistItem } from '@quartermaster/shared';

const marks: Record<ChecklistItem['status'], { symbol: string; label: string }> = {
  pending: { symbol: '○', label: 'To do' },
  in_progress: { symbol: '◐', label: 'In progress' },
  done: { symbol: '✓', label: 'Done' },
  blocked: { symbol: '⏸', label: 'Blocked' },
};

// Starts closed so the conversation stays in view; the header keeps the progress and current step.
export function Checklist({ items }: { items: ChecklistItem[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'done').length;
  const current = items.find((item) => item.status === 'in_progress');
  return (
    <aside className="chat-checklist" aria-label="Agent checklist">
      <h3>
        <button
          type="button"
          className="chat-checklist-toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true" className="chat-checklist-chevron">
            ▸
          </span>
          Checklist
          <span className="chat-checklist-progress">
            {done}/{items.length} done
            {!open && current && ` · ${current.title}`}
          </span>
        </button>
      </h3>
      <ul id={listId} hidden={!open}>
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
