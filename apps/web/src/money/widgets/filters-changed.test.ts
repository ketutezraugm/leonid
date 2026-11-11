import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { reportState, resetFiltersVersion, startFrom, useFiltersVersion } from './filters-changed';

const page = (crossFilter?: unknown, filter?: unknown, extra: object = {}) => ({
  pages: [{ id: 'overview', crossFilter, filter, ...extra }],
});

// The shape Studio really reports (seen in a real run): selections are keyed by the widget that made them.
const selection = (field: string, value: string, widget = 'funding') => ({
  values: { [widget]: [{ type: 'value', group: 0, field: { id: field }, values: [value] }] },
});

describe('filters version', () => {
  beforeEach(resetFiltersVersion);

  it('counts the first selection as a change, because Studio never reports its starting state', () => {
    const { result } = renderHook(() => useFiltersVersion());
    startFrom(page());

    act(() => reportState(page(selection('sponsors.name', 'Alder Labs'))));

    expect(result.current).toBe(1);
  });

  it('does not count a report that matches the starting state as a change', () => {
    const { result } = renderHook(() => useFiltersVersion());
    startFrom(page());

    act(() => reportState(page()));

    expect(result.current).toBe(0);
  });

  it('moves with every change to the selection, from one value to the next and back to none', () => {
    const { result } = renderHook(() => useFiltersVersion());
    startFrom(page());

    act(() => reportState(page(selection('categories.category', 'prizes', 'burn'))));
    expect(result.current).toBe(1);

    act(() => reportState(page(selection('categories.category', 'food', 'burn'))));
    expect(result.current).toBe(2);

    act(() => reportState(page(undefined)));
    expect(result.current).toBe(3);
  });

  it('moves when a page filter changes', () => {
    const { result } = renderHook(() => useFiltersVersion());
    startFrom(page());

    act(() => reportState(page(undefined, { logic: 'and', conditions: [] })));

    expect(result.current).toBe(1);
  });

  it('does not move for a state change that is not about the filters, such as a layout tweak', () => {
    const { result } = renderHook(() => useFiltersVersion());
    const chosen = selection('categories.category', 'prizes', 'burn');
    startFrom(page(chosen));

    act(() => reportState(page(chosen, undefined, { widgetLayout: { rules: {} } })));
    act(() => reportState(page(chosen)));

    expect(result.current).toBe(0);
  });

  it('tells every widget that is listening', () => {
    const a = renderHook(() => useFiltersVersion());
    const b = renderHook(() => useFiltersVersion());
    startFrom(page());

    act(() => reportState(page(selection('sponsors.name', 'Alder Labs'))));

    expect([a.result.current, b.result.current]).toEqual([1, 1]);
  });

  it('stops telling a widget that has gone away', () => {
    const { result, unmount } = renderHook(() => useFiltersVersion());
    startFrom(page());
    unmount();

    act(() => reportState(page(selection('sponsors.name', 'Alder Labs'))));

    expect(result.current).toBe(0);
  });

  it('starts over when the command center is shown again, whatever was selected last time', () => {
    const { result } = renderHook(() => useFiltersVersion());
    startFrom(page());
    act(() => reportState(page(selection('sponsors.name', 'Alder Labs'))));

    // The page is left and visited again: Studio starts from the default report, with nothing selected.
    startFrom(page());
    act(() => reportState(page(selection('sponsors.name', 'Alder Labs'))));

    expect(result.current).toBe(2);
  });

  it('copes with a state that has no pages, which is the same as one with nothing selected', () => {
    const { result } = renderHook(() => useFiltersVersion());
    startFrom({});

    act(() => reportState({}));
    act(() => reportState({ pages: [] }));

    expect(result.current).toBe(0);
  });
});
