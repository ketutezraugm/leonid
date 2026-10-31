import { TaskModel, type TaskModelConfig } from '@bryntum/gantt';
import type { Status } from '../ui/StatusBadge';

// A Gantt task carrying our shared status, which colors its bar (see PlanGantt).
export class PlanTask extends TaskModel {
  static fields = [{ name: 'status', type: 'string', defaultValue: 'pending' }];

  declare status: Status;
}

export type PlanTaskConfig = TaskModelConfig & { status: Status };
