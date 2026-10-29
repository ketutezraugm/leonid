import { useState, type KeyboardEvent } from 'react';
import type { ChatThreadSummary } from '@quartermaster/shared';
import { timeAgo } from './sessions';

export function ThreadList({
  threads,
  activeId,
  disabled,
  onSelect,
  onNew,
  onRename,
  onArchive,
  onDelete,
}: {
  threads: ChatThreadSummary[];
  activeId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // Delete has no undo, so it asks once inline before it goes.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function commit(thread: ChatThreadSummary) {
    const title = draft.trim();
    setEditing(null);
    if (title && title !== thread.title) onRename(thread.id, title);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, thread: ChatThreadSummary) {
    if (event.key === 'Enter') commit(thread);
    if (event.key === 'Escape') setEditing(null);
  }

  return (
    <nav className="chat-threads" aria-label="Chats">
      <button type="button" className="chat-new" onClick={onNew} disabled={disabled}>
        New chat
      </button>
      <ul>
        {threads.map((thread) => (
          <li key={thread.id} className={thread.id === activeId ? 'is-active' : undefined}>
            {editing === thread.id ? (
              <input
                aria-label="Chat title"
                autoFocus
                maxLength={80}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => onKeyDown(event, thread)}
                onBlur={() => commit(thread)}
              />
            ) : (
              <button
                type="button"
                className="chat-thread-open"
                aria-current={thread.id === activeId ? 'true' : undefined}
                disabled={disabled}
                onClick={() => onSelect(thread.id)}
              >
                <span className="chat-thread-title">{thread.title}</span>
                <small className="muted">{timeAgo(thread.updatedAt)}</small>
              </button>
            )}
            {confirming === thread.id ? (
              <span className="chat-thread-actions" role="group" aria-label="Confirm delete">
                <span className="muted">Delete for good?</span>
                <button
                  type="button"
                  className="chat-thread-danger"
                  aria-label={`Confirm delete ${thread.title}`}
                  disabled={disabled}
                  onClick={() => {
                    setConfirming(null);
                    onDelete(thread.id);
                  }}
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="chat-thread-actions">
                <button
                  type="button"
                  aria-label={`Rename ${thread.title}`}
                  onClick={() => {
                    setDraft(thread.title);
                    setEditing(thread.id);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  aria-label={`Archive ${thread.title}`}
                  disabled={disabled}
                  onClick={() => onArchive(thread.id)}
                >
                  Archive
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${thread.title}`}
                  disabled={disabled}
                  onClick={() => setConfirming(thread.id)}
                >
                  Delete
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
