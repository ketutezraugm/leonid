import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { countdown, daysUntil, EVENT, eventPath, formatEventDate, useEvent, useEventRouteId, withEvent } from './event';

const at = (path: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(MemoryRouter, { initialEntries: [path] }, children);
  };

describe('useEvent', () => {
  it('gives the seeded demo event, with no API id, when there is no events list', () => {
    const { result } = renderHook(() => useEvent(), { wrapper: at('/events') });
    expect(result.current).toEqual({ id: null, routeId: 'demo', ...EVENT });
  });

  it('returns the same object on every render, so it is safe in dependency arrays', () => {
    const { result, rerender } = renderHook(() => useEvent(), { wrapper: at('/events/demo/plan') });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('reads the event id from the URL, from anywhere in the app', () => {
    expect(renderHook(() => useEventRouteId(), { wrapper: at('/events/abc/plan') }).result.current).toBe('abc');
    expect(renderHook(() => useEventRouteId(), { wrapper: at('/events/abc') }).result.current).toBe('abc');
    expect(renderHook(() => useEventRouteId(), { wrapper: at('/settings') }).result.current).toBeNull();
  });
});

describe('eventPath and withEvent', () => {
  it('builds paths inside one event', () => {
    expect(eventPath('demo')).toBe('/events/demo');
    expect(eventPath('demo', 'plan')).toBe('/events/demo/plan');
    expect(eventPath('demo', '/approvals')).toBe('/events/demo/approvals');
  });

  it('adds ?eventId= only when the event has an API id', () => {
    expect(withEvent('/api/approvals', { id: null })).toBe('/api/approvals');
    expect(withEvent('/api/approvals', { id: 'e1' })).toBe('/api/approvals?eventId=e1');
    expect(withEvent('/api/widgets?x=1', { id: 'e1' })).toBe('/api/widgets?x=1&eventId=e1');
  });
});

describe('countdown', () => {
  it('says how far away the event is in words', () => {
    const today = new Date();
    const iso = (days: number) => new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    expect(countdown(iso(10))).toBe('10 days to go');
    expect(countdown(iso(1))).toBe('1 day to go');
    expect(countdown(iso(0))).toBe('Today');
    expect(countdown(iso(-3))).toBe('Event over');
  });
});

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
