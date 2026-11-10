// The maths behind Leo's gaze on the landing page. Leo is flat SVG; what sells a head turning is parallax:
// the face rides on top of the mane and moves further than it, the nose further still, and the mane drifts the
// other way. All offsets are in the mascot's 200x200 viewBox units.

/** Where the pointer is relative to Leo, as a direction in (-1, 1) per axis, soft-saturated so it never hits a stop. */
export function aim(px: number, py: number, cx: number, cy: number, rx: number, ry: number): [number, number] {
  const sat = (v: number) => v / Math.sqrt(1 + v * v);
  return [sat((px - cx) / rx), sat((py - cy) / ry)];
}

/** Frame-rate-independent easing of `cur` towards `target`. */
export function approach(cur: number, target: number, dt: number, rate: number): number {
  return target + (cur - target) * Math.exp(-rate * dt);
}

/** How far each layer moves for a gaze of (x, y); `near` (0..1) widens the eyes as the pointer comes close. */
export function pose(x: number, y: number, near: number) {
  return {
    mane: { dx: -x * 3, dy: -y * 2 },
    head: { dx: x * 5, dy: y * 4, rot: x * 5 },
    features: { dx: x * 12, dy: y * (y < 0 ? 8 : 12) },
    nose: { dx: x * 4, dy: y * 3 },
    eyes: { dx: x * 2, dy: y * 2, scale: 1 + near * 0.12 },
  };
}

/** Blink envelope over a 150ms blink: 1 is open, dipping towards 0.08. */
export function blink(since: number): number {
  const d = 0.15;
  if (since < 0 || since > d) return 1;
  return 1 - Math.sin((Math.PI * since) / d) * 0.92;
}
