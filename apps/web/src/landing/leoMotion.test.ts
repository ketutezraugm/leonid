import { describe, expect, it } from 'vitest';
import { aim, approach, blink, pose } from './leoMotion';

describe("Leo's gaze", () => {
  it('turns towards the pointer and never past a full turn', () => {
    const [x, y] = aim(1000, 100, 100, 100, 300, 300);
    expect(x).toBeGreaterThan(0.9);
    expect(x).toBeLessThan(1);
    expect(y).toBe(0);
    expect(aim(-1e6, -1e6, 0, 0, 1, 1).every((v) => v > -1)).toBe(true);
  });

  it('eases towards the target at the same speed whatever the frame rate', () => {
    const oneStep = approach(0, 1, 0.032, 7);
    const twoSteps = approach(approach(0, 1, 0.016, 7), 1, 0.016, 7);
    expect(oneStep).toBeCloseTo(twoSteps, 10);
  });

  it('moves the nose further than the face and the mane the other way', () => {
    const p = pose(1, 0, 0);
    expect(p.features.dx).toBeGreaterThan(p.head.dx);
    expect(p.mane.dx).toBeLessThan(0);
    expect(pose(0, 0, 1).eyes.scale).toBeGreaterThan(1);
  });

  it('blinks for 150ms and is open otherwise', () => {
    expect(blink(-1)).toBe(1);
    expect(blink(0.2)).toBe(1);
    expect(blink(0.075)).toBeCloseTo(0.08, 5);
  });
});
