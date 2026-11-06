import { useState } from 'react';
import { ConfirmDialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { ApiFailure, errorMessage, sendNoContent } from './api';
import { useEvents, type EventInfo } from './event';

// Confirms and deletes one event, from All events or from inside the event. The server refuses the demo event and
// any event with money history (409, reason in plain words), so this only ever removes an event that never touched money.
export function DeleteEventDialog({
  event,
  onClose,
  onDeleted,
}: {
  event: EventInfo;
  onClose: () => void;
  /** After a successful delete, before the list refreshes: a screen inside the event leaves it here. */
  onDeleted?: () => void;
}) {
  const { refresh } = useEvents();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!event.id) return;
    setBusy(true);
    try {
      await sendNoContent(`/api/events/${encodeURIComponent(event.id)}`);
      toast.success(`Deleted ${event.name}.`);
      onDeleted?.();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 409) toast.error(err.message);
      else toast.error(errorMessage(err instanceof ApiFailure ? err : new ApiFailure(0, '')).title);
    } finally {
      refresh();
      setBusy(false);
      onClose();
    }
  }

  return (
    <ConfirmDialog
      title={`Delete ${event.name}?`}
      confirmLabel="Delete event"
      busyLabel="Deleting…"
      danger
      busy={busy}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    >
      <p>
        This removes the event with its plan, sponsors and agent chats. It can't be undone. An event that has taken or
        spent money can't be deleted, so its records stay intact.
      </p>
    </ConfirmDialog>
  );
}
