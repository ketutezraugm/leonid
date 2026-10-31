import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

// Tabs with arrow-key navigation. The caller owns which tab is selected and renders its panel
// with TabPanel, so a heavy panel (AG Studio) is only mounted while it is the active one.
export function Tabs({
  items,
  selected,
  onSelect,
  label,
}: {
  items: TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = items[next]!;
    onSelect(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[item.id] = el;
          }}
          type="button"
          role="tab"
          id={`${base}-${item.id}-tab`}
          aria-selected={item.id === selected}
          aria-controls={`${base}-${item.id}-panel`}
          tabIndex={item.id === selected ? 0 : -1}
          className="tab"
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ children }: { children: ReactNode }) {
  return (
    <div role="tabpanel" className="tab-panel">
      {children}
    </div>
  );
}
