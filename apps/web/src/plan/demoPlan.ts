import type { DependencyModelConfig, TaskModelConfig } from '@bryntum/gantt';
import type { Status } from '../ui/StatusBadge';
import type { PlanSponsor, SourceTask } from './gating';

// Sample OpenHack 2027 plan, used until the plan endpoint exists (F11). It shows the plan rule judges
// care about: purchases funded by a sponsor depend on that sponsor's invoice task and stay blocked until
// it's paid. Sponsor names match the seed (apps/api/src/db/seed.ts); they are fictional on purpose.

export const EVENT_DAY = '2027-03-14';

export const HARBOR = 'harbor-cloud';
export const LUMEN = 'lumen-labs';
export const PIXEL = 'pixel-foundry';

export const demoSponsors: PlanSponsor[] = [
  { id: HARBOR, name: 'Harbor Cloud', status: 'invoiced' },
  { id: LUMEN, name: 'Lumen Labs', status: 'paid' },
  { id: PIXEL, name: 'Pixel Foundry', status: 'invoiced' },
];

function task(
  id: number,
  name: string,
  startDate: string,
  duration: number,
  status: Status,
  extra: Partial<TaskModelConfig> & Pick<SourceTask, 'fundedBySponsorId' | 'invoiceOfSponsorId'> = {},
): SourceTask {
  // Pin each start date: otherwise the scheduler pulls a task with no predecessor to the project start.
  return { id, name, startDate, duration, status, constraintType: 'startnoearlierthan', constraintDate: startDate, ...extra };
}

export const demoTasks: SourceTask[] = [
  task(1, 'Venue deposit', '2027-01-11', 2, 'done', { percentDone: 100 }),
  task(2, 'Harbor Cloud invoice, $3,000', '2027-01-11', 21, 'pending', { invoiceOfSponsorId: HARBOR }),
  task(3, 'Lumen Labs invoice, $2,500', '2027-01-11', 14, 'pending', { invoiceOfSponsorId: LUMEN }),
  task(4, 'Pixel Foundry invoice, $2,500', '2027-01-18', 21, 'pending', { invoiceOfSponsorId: PIXEL }),
  task(5, 'Order swag (lanyards, T-shirts)', '2027-02-01', 2, 'pending', { fundedBySponsorId: HARBOR }),
  task(6, 'Swag delivery', '2027-02-03', 21, 'pending', { deadlineDate: '2027-03-07' }),
  task(7, 'Speaker travel', '2027-02-01', 3, 'pending', { fundedBySponsorId: HARBOR }),
  task(8, 'Buy prizes', '2027-01-25', 3, 'progress', { fundedBySponsorId: LUMEN }),
  task(9, 'Prize delivery', '2027-01-28', 10, 'pending', { deadlineDate: '2027-03-10' }),
  task(10, 'Book AV', '2027-01-13', 5, 'done', { percentDone: 100, deadlineDate: '2027-03-01' }),
  task(11, 'Catering deposit', '2027-02-08', 2, 'pending', { fundedBySponsorId: PIXEL }),
  task(12, 'Snacks and drinks order', '2027-03-01', 2, 'pending', { fundedBySponsorId: PIXEL, deadlineDate: '2027-03-12' }),
  task(13, 'Badges and adapters printed', '2027-03-01', 3, 'pending', { deadlineDate: '2027-03-10' }),
  task(14, 'Volunteer briefing', '2027-03-08', 1, 'pending'),
  task(15, 'Event day', EVENT_DAY, 0, 'pending', { constraintType: 'muststarton', constraintDate: EVENT_DAY }),
];

export const demoDependencies: DependencyModelConfig[] = [
  { id: 1, from: 2, to: 5 },
  { id: 2, from: 2, to: 7 },
  { id: 3, from: 3, to: 8 },
  { id: 4, from: 4, to: 11 },
  { id: 5, from: 4, to: 12 },
  { id: 6, from: 5, to: 6 },
  { id: 7, from: 8, to: 9 },
  { id: 8, from: 1, to: 10 },
  { id: 9, from: 11, to: 12 },
  { id: 10, from: 6, to: 15 },
  { id: 11, from: 7, to: 15 },
  { id: 12, from: 9, to: 15 },
  { id: 13, from: 10, to: 15 },
  { id: 14, from: 12, to: 15 },
  { id: 15, from: 13, to: 15 },
  { id: 16, from: 14, to: 15 },
];
