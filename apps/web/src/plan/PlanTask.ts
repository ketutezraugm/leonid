import { TaskModel, type TaskModelConfig } from '@bryntum/gantt';
import type { Status } from '../ui/StatusBadge';

// A Gantt task carrying our shared status, which colors its bar (see PlanGantt), and the sponsor
// whose unpaid invoice is holding it (see gating.ts).
export class PlanTask extends TaskModel {
  static fields = [
    { name: 'status', type: 'string', defaultValue: 'pending' },
    { name: 'waitingOn', type: 'string', defaultValue: null },
  ];

  declare status: Status;
  declare waitingOn: string | null;
}

export type PlanTaskConfig = TaskModelConfig & { status: Status; waitingOn: string | null };
