import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

// A modal for one decision. The consequence goes in the body in plain words; the confirm button
// names the action ("Revoke agent wallet"), never "OK". Esc and Cancel close it unless it is busy.
export function ConfirmDialog({
  title,
  confirmLabel,
  busyLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Land on Cancel: the safe choice for a destructive dialog.
    cancel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="dialog-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="btn-row dialog-actions">
          <button ref={cancel} type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} busyLabel={busyLabel} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
