import { TaskModel, type TaskModelConfig } from '@bryntum/gantt-thin';
import type { Status } from '../ui/StatusBadge';

// A Gantt task carrying our shared status, which colors its bar (see PlanGantt), and the sponsor whose money
// funds it, if any (see gating.ts).
export class PlanTask extends TaskModel {
  static fields = [
    { name: 'status', type: 'string', defaultValue: 'pending' },
    { name: 'fundedBy', type: 'string', defaultValue: null },
    { name: 'fundedByPaid', type: 'boolean', defaultValue: false },
  ];

  declare status: Status;
  declare fundedBy: string | null;
  declare fundedByPaid: boolean;
}

export type PlanTaskConfig = TaskModelConfig & {
  status: Status;
  fundedBy: string | null;
  fundedByPaid: boolean;
};
