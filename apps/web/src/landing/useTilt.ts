import { useEffect, type RefObject } from 'react';

// Tilts every [data-tilt] card inside `root` towards the pointer, in 3D, with a soft glare that follows it.
// The angle eases on a spring (stiffness 200, damping 15, mass 0.3), so the card keeps a little momentum instead of
// snapping to the mouse. Only with a real pointer and without reduced motion; touch screens never see it.
// The tilt owns `transform`; the scroll reveal moves cards with `translate`, so the two never fight.
export function useTiltCards(root: RefObject<HTMLElement | null>, max = 8) {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof window.matchMedia !== 'function' || typeof window.requestAnimationFrame !== 'function') return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || reduce.matches) return;
    const detach = Array.from(el.querySelectorAll<HTMLElement>('[data-tilt]')).map((card) => attach(card, max));
    return () => detach.forEach((d) => d());
  }, [root, max]);
}

const K = 200;
const C = 15;
const M = 0.3;

function attach(card: HTMLElement, max: number): () => void {
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let raf = 0;
  let last = 0;

  const step = (now: number) => {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Small fixed substeps keep the stiff spring stable at any frame rate.
    while (dt > 0) {
      const h = Math.min(dt, 0.004);
      vx += ((K * (targetX - x) - C * vx) / M) * h;
      vy += ((K * (targetY - y) - C * vy) / M) * h;
      x += vx * h;
      y += vy * h;
      dt -= h;
    }
    const resting = targetX === 0 && targetY === 0 && Math.abs(x) + Math.abs(y) < 0.01 && Math.abs(vx) + Math.abs(vy) < 0.01;
    if (resting) {
      card.style.transform = '';
      raf = 0;
      return;
    }
    card.style.transform = `perspective(1000px) rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg)`;
    raf = window.requestAnimationFrame(step);
  };

  const run = () => {
    if (raf) return;
    last = performance.now();
    raf = window.requestAnimationFrame(step);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    targetY = (px - 0.5) * max;
    targetX = (0.5 - py) * max;
    card.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    card.classList.add('is-tilting');
    run();
  };

  const onLeave = () => {
    targetX = 0;
    targetY = 0;
    card.classList.remove('is-tilting');
    run();
  };

  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerleave', onLeave);
  return () => {
    window.cancelAnimationFrame(raf);
    card.removeEventListener('pointermove', onMove);
    card.removeEventListener('pointerleave', onLeave);
    card.style.transform = '';
    card.classList.remove('is-tilting');
  };
}
