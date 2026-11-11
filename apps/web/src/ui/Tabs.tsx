import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

// Tabs with arrow-key navigation. The caller owns which tab is selected and renders its panel
// with TabPanel, so a heavy panel (AG Studio) is only mounted while it is the active one.
// The selection slides: one underline moves to the new tab, and an accent copy of the labels, clipped to the
// active tab, moves with it, so each label changes color exactly as the line passes over it. The copy is drawn by
// CSS (attr(data-label)), so screen readers and tests still see each label once.
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
  const listRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  // Written straight to the DOM before paint, so the first position never animates in from the left edge.
  useLayoutEffect(() => {
    const list = listRef.current;
    const place = () => {
      const tab = refs.current[selected];
      if (!list || !tab || !lineRef.current || !copyRef.current) return;
      const left = tab.offsetLeft;
      const right = list.scrollWidth - left - tab.offsetWidth;
      lineRef.current.style.transform = `translateX(${left}px) scaleX(${tab.offsetWidth})`;
      copyRef.current.style.clipPath = `inset(0 ${right}px 0 ${left}px)`;
    };
    place();
    if (!list) return;
    // Transitions switch on only after the first placement.
    const raf = requestAnimationFrame(() => (list.dataset.ready = 'true'));
    // Labels change width when the web font arrives or the window resizes, so measure again then.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(list);
    for (const tab of Object.values(refs.current)) if (tab) ro?.observe(tab);
    let live = true;
    void document.fonts?.ready.then(() => live && place());
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [selected, items]);

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
    <div ref={listRef} className="tabs" role="tablist" aria-label={label}>
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
      <div ref={copyRef} className="tabs-copy" aria-hidden="true">
        {items.map((item) => (
          <span key={item.id} className="tab tab-copy" data-label={item.label} />
        ))}
      </div>
      <span ref={lineRef} className="tabs-line" aria-hidden="true" />
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
