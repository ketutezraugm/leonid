import { describe, expect, it } from 'vitest';
import { titleFrom } from './threads.js';

describe('titleFrom', () => {
  it('keeps short text and collapses whitespace', () => {
    expect(titleFrom('  Plan\n swag  ')).toBe('Plan swag');
  });

  it('cuts long text on a word boundary', () => {
    const title = titleFrom('Find two hundred lanyards under one dollar each from a supplier in Jakarta');
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toMatch(/\s…$/);
  });

  it('falls back when empty', () => {
    expect(titleFrom('   ')).toBe('New chat');
  });
});
