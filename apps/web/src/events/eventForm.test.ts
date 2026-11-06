import { describe, expect, it } from 'vitest';
import { parseCategories, validateEventForm } from './eventForm';

const NOW = new Date('2026-11-02T10:00:00Z');
const good = { name: ' Test Meetup ', date: '2027-05-01', endDate: '2027-05-03', people: '80', budget: '$2,500.50', categories: 'Venue, swag, venue', city: ' Jakarta ' };

describe('validateEventForm', () => {
  it('leaves the city out when it is blank', () => {
    const result = validateEventForm({ ...good, city: '  ' }, NOW);
    expect(result.ok && 'city' in result.request && result.request.city).toBeFalsy();
  });

  it('turns what was typed into the shared request, in integer cents', () => {
    const result = validateEventForm(good, NOW);
    expect(result).toEqual({
      ok: true,
      request: {
        name: 'Test Meetup',
        date: '2027-05-01',
        endDate: '2027-05-03',
        people: 80,
        currency: 'USD',
        budget: 250_050,
        categories: ['venue', 'swag'],
        city: 'Jakarta',
      },
    });
  });

  it('says what to fix, field by field', () => {
    const result = validateEventForm({ name: ' ', date: '', endDate: '', people: 'many', budget: 'lots', categories: '', city: '' }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['budget', 'date', 'endDate', 'name', 'people']);
  });

  it('accepts today and refuses yesterday', () => {
    expect(validateEventForm({ ...good, date: '2026-11-02' }, NOW).ok).toBe(true);
    const past = validateEventForm({ ...good, date: '2026-11-01' }, NOW);
    expect(past).toMatchObject({ ok: false, errors: { date: expect.stringMatching(/today or a later day/) } });
  });

  it('refuses a headcount or budget past the shared limits', () => {
    expect(validateEventForm({ ...good, people: '100001' }, NOW)).toMatchObject({ ok: false, errors: { people: expect.any(String) } });
    expect(validateEventForm({ ...good, budget: '20000000' }, NOW)).toMatchObject({ ok: false, errors: { budget: expect.any(String) } });
  });

  it('allows a zero budget and no categories', () => {
    expect(validateEventForm({ ...good, budget: '0', categories: '' }, NOW)).toMatchObject({
      ok: true,
      request: { budget: 0, categories: [] },
    });
  });
});

describe('parseCategories', () => {
  it('trims, lower-cases and drops repeats and blanks', () => {
    expect(parseCategories(' Venue ,, swag,VENUE ')).toEqual(['venue', 'swag']);
    expect(parseCategories('')).toEqual([]);
  });

  it('refuses a last day before the first day', () => {
    const result = validateEventForm({ ...good, endDate: '2027-04-30' }, NOW);
    expect(result).toMatchObject({ ok: false, errors: { endDate: expect.any(String) } });
  });
});
