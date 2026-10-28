import type { DependencyModelConfig, TaskModelConfig } from '@bryntum/gantt';
import type { Status } from '../ui/StatusBadge';
import type { PlanTaskConfig } from './PlanTask';

// Static slice of the seeded OpenHack 2027 plan, used until the task endpoints
// exist (F11). It shows the plan rule judges care about: purchases funded by a
// sponsor depend on that sponsor's invoice task and stay blocked until it's paid.

export const EVENT_DAY = '2027-03-14';

function task(
  id: number,
  name: string,
  startDate: string,
  duration: number,
  status: Status,
  extra: Partial<TaskModelConfig> = {},
): PlanTaskConfig {
  return { id, name, startDate, duration, status, ...extra };
}

export const demoTasks: PlanTaskConfig[] = [
  task(1, 'Venue deposit', '2027-01-11', 2, 'done', { percentDone: 100 }),
  task(2, 'Gold sponsor invoice paid', '2027-01-11', 14, 'progress', { note: 'PayPal invoice' }),
  task(3, 'Order swag (lanyards, T-shirts)', '2027-01-25', 2, 'blocked', {
    note: 'Waiting on the Gold sponsor payment',
  }),
  task(4, 'Swag delivery', '2027-01-27', 21, 'pending', { deadlineDate: '2027-03-07' }),
  task(5, 'Buy prizes', '2027-01-25', 3, 'blocked', {
    note: 'Waiting on the Gold sponsor payment',
  }),
  task(6, 'Book AV and catering', '2027-01-13', 5, 'pending', { deadlineDate: '2027-03-01' }),
  task(7, 'Event day', EVENT_DAY, 0, 'pending', {
    constraintType: 'muststarton',
    constraintDate: EVENT_DAY,
  }),
];

export const demoDependencies: DependencyModelConfig[] = [
  { id: 1, from: 2, to: 3 },
  { id: 2, from: 2, to: 5 },
  { id: 3, from: 3, to: 4 },
  { id: 4, from: 1, to: 6 },
  { id: 5, from: 4, to: 7 },
  { id: 6, from: 5, to: 7 },
  { id: 7, from: 6, to: 7 },
];
