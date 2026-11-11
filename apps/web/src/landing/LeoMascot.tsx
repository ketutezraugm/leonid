import { useEffect, useRef, useState } from 'react';
import { aim, approach, blink, pose } from './leoMotion';

// Leo, the agent, as the landing page's mascot (the "Crest" direction): a lion whose mane is two rounded squares
// and whose nose is the meteor's pink. Landing only; inside the app the meteor stays in the mark (BRAND.md).
// Leo follows the pointer, blinks, looks around when nobody is there, and answers a click in its own voice.

// Leo's voice (design system README): numbers first, the rule second, no hype.
export const LEO_LINES = [
  "Hi, I'm Leo. I run your event's money, always inside your rules.",
  'Bought 200 lanyards for $140.00. Your $200 rule allowed it.',
  'The $420.00 prize cart is inside your rules, so I paid it and logged why.',
  "I can't buy from that seller: it isn't on your approved list.",
];

export function LeoMascot({ decorative = false, className }: { decorative?: boolean; className?: string }) {
  const box = useRef<HTMLElement | null>(null);
  const maneRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const featuresRef = useRef<SVGGElement>(null);
  const noseRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const [happy, setHappy] = useState(false);
  const [said, setSaid] = useState(-1);
  const happyTimer = useRef<number | undefined>(undefined);

  function poke() {
    setSaid((n) => (n + 1) % LEO_LINES.length);
    setHappy(true);
    window.clearTimeout(happyTimer.current);
    happyTimer.current = window.setTimeout(() => setHappy(false), 2600);
  }
  useEffect(() => () => window.clearTimeout(happyTimer.current), []);

  // The pointer drives the SVG directly; running it through React state would re-render 60 times a second.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof window.requestAnimationFrame !== 'function') return;

    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let still = mq?.matches ?? false;
    const onMq = () => (still = mq?.matches ?? false);
    mq?.addEventListener('change', onMq);

    let px = 0;
    let py = 0;
    let lastMove = -1e9;
    let gx = 0;
    let gy = 0;
    let near = 0;
    let prev = performance.now();
    let nextBlink = prev + 1800;
    let blinkAt = -1e9;
    let visible = true;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      lastMove = performance.now();
    };
    const onLeave = () => (lastMove = -1e9);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    const tr = (dx: number, dy: number) => `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`;
    const L = {
      mane: maneRef.current,
      head: headRef.current,
      features: featuresRef.current,
      nose: noseRef.current,
      eyes: eyesRef.current,
    };

    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);
      if (!visible) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      const r = el.getBoundingClientRect();
      const cx = r.left + r.width * 0.5;
      const cy = r.top + r.height * 0.52;
      let tx = 0;
      let ty = 0;
      let tn = 0;
      if (now - lastMove < 3500) {
        const reach = Math.max(window.innerWidth, window.innerHeight);
        [tx, ty] = aim(px, py, cx, cy, reach * 0.3, reach * 0.26);
        tn = Math.max(0, 1 - Math.hypot(px - cx, py - cy) / (r.width * 0.45));
      } else if (!still) {
        // Nobody is there: Leo looks around on its own.
        const t = now / 1000;
        tx = Math.sin(t * 0.45) * 0.55 + Math.sin(t * 1.1) * 0.1;
        ty = Math.sin(t * 0.31 + 1) * 0.25;
      }

      const rate = still ? 30 : 7;
      gx = approach(gx, tx, dt, rate);
      gy = approach(gy, ty, dt, rate);
      near = approach(near, tn, dt, 8);
      const p = pose(gx, gy, near);
      const breathe = still ? 0 : Math.sin(now / 620) * 1.2;

      if (!still && now > nextBlink) {
        blinkAt = now;
        // Now and then a double blink.
        nextBlink = now + (Math.random() < 0.2 ? 260 : 2200 + Math.random() * 3200);
      }
      const open = still ? 1 : blink((now - blinkAt) / 1000);

      L.mane?.setAttribute('transform', tr(p.mane.dx, p.mane.dy + breathe * 0.5));
      L.head?.setAttribute('transform', `${tr(p.head.dx, p.head.dy + breathe)} rotate(${p.head.rot.toFixed(2)} 100 104)`);
      L.features?.setAttribute('transform', tr(p.features.dx, p.features.dy));
      L.nose?.setAttribute('transform', tr(p.nose.dx, p.nose.dy));
      L.eyes?.setAttribute(
        'transform',
        `${tr(p.eyes.dx, p.eyes.dy)} translate(100 98) scale(${p.eyes.scale.toFixed(3)} ${(p.eyes.scale * open).toFixed(3)}) translate(-100 -98)`,
      );
    };
    raf = window.requestAnimationFrame(frame);

    // Offscreen, the loop keeps its slot but does no work.
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => {
            visible = Boolean(entry?.isIntersecting);
            prev = performance.now();
          })
        : null;
    io?.observe(el);

    return () => {
      window.cancelAnimationFrame(raf);
      io?.disconnect();
      mq?.removeEventListener('change', onMq);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  const art = (
    <svg className="leo-art" viewBox="0 0 200 200" aria-hidden="true">
      <g ref={maneRef}>
        <g className="leo-mane">
          <rect x="44" y="48" width="112" height="112" rx="20" />
          <rect x="44" y="48" width="112" height="112" rx="20" transform="rotate(45 100 104)" />
        </g>
      </g>
      <g ref={headRef}>
        <circle className="leo-face" cx="100" cy="104" r="42" />
        <g ref={featuresRef}>
          <ellipse className="leo-blush" cx="78" cy="116" rx="8" ry="4.5" />
          <ellipse className="leo-blush" cx="122" cy="116" rx="8" ry="4.5" />
          <g ref={eyesRef}>
            {happy ? (
              <>
                <path className="leo-line" d="M79 100 Q85 92 91 100" />
                <path className="leo-line" d="M109 100 Q115 92 121 100" />
              </>
            ) : (
              <>
                <ellipse className="leo-ink" cx="85" cy="98" rx="5.5" ry="7.5" />
                <ellipse className="leo-ink" cx="115" cy="98" rx="5.5" ry="7.5" />
                <circle className="leo-glint" cx="87" cy="95" r="2" />
                <circle className="leo-glint" cx="117" cy="95" r="2" />
              </>
            )}
          </g>
          <g ref={noseRef}>
            <path className="leo-nose" d="M93 112 L107 112 L100 120 Z" />
            {happy ? (
              <path className="leo-ink" d="M88 124 Q100 122 112 124 Q110 138 100 138 Q90 138 88 124 Z" />
            ) : (
              <path className="leo-line" d="M100 120 L100 125 M100 125 Q94 131 89 127 M100 125 Q106 131 111 127" />
            )}
          </g>
        </g>
      </g>
    </svg>
  );

  const classes = ['leo', happy ? 'leo-happy' : '', className].filter(Boolean).join(' ');
  if (decorative) {
    return (
      <span ref={(el) => void (box.current = el)} className={classes} aria-hidden="true">
        {art}
      </span>
    );
  }
  return (
    <button ref={(el) => void (box.current = el)} type="button" className={classes} onClick={poke} aria-label="Say hi to Leo">
      {art}
      <span className="leo-bubble" data-on={happy} aria-live="polite">
        {said >= 0 ? LEO_LINES[said] : ''}
      </span>
    </button>
  );
}
