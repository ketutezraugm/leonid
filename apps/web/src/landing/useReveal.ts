import { useEffect, useRef, type CSSProperties } from 'react';

// Reveals a section's [data-reveal] children the first time it scrolls into view: text rises in one after another,
// a [data-reveal="drop"] card drops in from above (styles in landing.css). The hiding class is added here, not in
// the markup, so without JavaScript or IntersectionObserver everything simply shows.
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return;
    el.classList.add('lp-reveal');
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.classList.add('is-in');
        io.disconnect();
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/** The stagger slot of one revealed item: 0 goes first, each next one 150ms later. */
export const revealAt = (i: number) => ({ '--i': i }) as CSSProperties;
