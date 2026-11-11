import { parseBookingChoice } from '@leonid/shared';
import { describe, expect, it } from 'vitest';
import { answers, defaultNeeds, kickoffText, newBrief, type Brief } from './eventBrief';

const brief: Brief = {
  ...newBrief('stage'),
  name: 'DevTalks',
  date: '2027-03-14',
  people: 150,
  city: 'Singapore',
  budget: 1_200_000,
  needsNote: 'a sign-language interpreter',
};

describe('event brief', () => {
  it('pre-ticks the venue only when the agent has to find one', () => {
    expect(defaultNeeds('meetup', 'find')).toEqual(['venue', 'catering']);
    expect(defaultNeeds('meetup', 'have')).toEqual(['catering']);
  });

  it('writes a first message the server reads the booking choice from', () => {
    const text = kickoffText(brief);
    expect(text).toContain(
      'Plan our new event, DevTalks: a stage event with talks for 150 people in Singapore on Sunday, March 14, 2027 (a full day).',
    );
    expect(text).toContain('Total budget: $12,000.');
    expect(text).toContain('I still need a venue, so find me one.');
    // Only bookable items count; the rest are coming soon.
    expect(parseBookingChoice(text)).toEqual({
      chosen: ['venue', 'catering'],
      extra: 'a sign-language interpreter',
    });
  });

  it('says when there is no city yet and the venue is sorted', () => {
    const text = kickoffText({
      ...brief,
      city: '',
      venue: 'have',
      needs: defaultNeeds('stage', 'have'),
    });
    expect(text).toContain('in a city I have not decided yet');
    expect(text).toContain('do not search for one');
    expect(parseBookingChoice(text)?.chosen).toEqual(['catering']);
  });

  it('summarises every answer', () => {
    const list = answers(brief);
    expect(list).toHaveLength(9);
    expect(list[0]).toEqual({ question: 'What kind of event?', answer: 'Stage event' });
    expect(list.at(-1)).toEqual({ question: 'What’s the total budget?', answer: '$12,000' });
  });
});
