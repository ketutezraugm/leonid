// The seeded demo event (OpenHack 2027). Until the Event schema and endpoint exist (UX plan: missing
// shapes), the shell reads it from here, in one place.
export const EVENT = {
  name: 'OpenHack 2027',
  date: '2027-03-14',
  people: 200,
  currency: 'USD',
} as const;

const DAY_MS = 86_400_000;

export function daysUntil(isoDate: string, now = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

export function formatEventDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
