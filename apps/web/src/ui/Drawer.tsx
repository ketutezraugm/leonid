import { useEffect, useRef, type ReactNode } from 'react';

// A panel that slides in from the right over a light scrim. Esc and the scrim close it.
// Children stay mounted while it is closed, so a running chat keeps its state.
export function Drawer({
  id,
  open,
  title,
  onClose,
  children,
}: {
  id: string;
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className="drawer-scrim" data-open={open} onClick={onClose} aria-hidden="true" />
      <aside
        id={id}
        ref={panel}
        className="drawer"
        data-open={open}
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        tabIndex={-1}
        // inert keeps a closed drawer out of the tab order without unmounting its content.
        {...(open ? {} : { inert: true })}
      >
        {children}
      </aside>
    </>
  );
}
