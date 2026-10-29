import { describe, expect, it } from 'vitest';
import { daysUntil, formatEventDate } from './event';

describe('daysUntil', () => {
  it('counts whole days to the event, ignoring the time of day', () => {
    expect(daysUntil('2027-03-14', new Date('2027-03-13T23:59:00Z'))).toBe(1);
    expect(daysUntil('2027-03-14', new Date('2027-03-14T00:01:00Z'))).toBe(0);
    expect(daysUntil('2027-03-14', new Date('2027-03-15T10:00:00Z'))).toBe(-1);
  });
});

describe('formatEventDate', () => {
  it('formats the date without shifting it by the viewer timezone', () => {
    expect(formatEventDate('2027-03-14')).toBe('Mar 14');
  });
});
