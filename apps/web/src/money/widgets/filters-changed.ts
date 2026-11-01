import { useSyncExternalStore } from 'react';

// Studio runs its own widgets again when a selection in another widget changes the filters, but it does not
// tell a custom widget. CommandCenter reports every Studio state change here, and a widget that lists rows
// reads `useFiltersVersion()` and fetches again when that number moves. Only a change to the filters moves
// it, not every layout tweak or title edit, so a widget is not refetched for nothing.

// The part of Studio's report state that decides what a widget is shown.
interface FilterBearingState {
  pages?: readonly { id: string; crossFilter?: unknown; filter?: unknown }[];
}

let version = 0;
// What the filters looked like at the last report. Null until something has said.
let signature: string | null = null;
const listeners = new Set<() => void>();

const signatureOf = (state: FilterBearingState): string =>
  JSON.stringify((state.pages ?? []).map((p) => [p.id, p.crossFilter ?? null, p.filter ?? null]));

// Studio reports changes, not its starting state, so its first report is already a selection being made.
// Say what the filters start as, so that first selection counts as the change it is.
export function startFrom(state: FilterBearingState): void {
  signature = signatureOf(state);
}

export function reportState(state: FilterBearingState): void {
  const next = signatureOf(state);
  if (next === signature) return;
  signature = next;
  version += 1;
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getVersion = () => version;

export const useFiltersVersion = (): number => useSyncExternalStore(subscribe, getVersion);

// For tests: a command center that is mounted again starts from a clean slate.
export function resetFiltersVersion(): void {
  version = 0;
  signature = null;
}
