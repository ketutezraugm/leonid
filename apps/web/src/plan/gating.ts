import type { SponsorStatus } from '@quartermaster/shared';
import type { Status } from '../ui/StatusBadge';
import type { PlanTaskConfig } from './PlanTask';

// The sponsor facts the plan needs: GET /api/sponsors (P3) returns these, plus more.
export interface PlanSponsor {
  id: string;
  name: string;
  status: SponsorStatus;
}

// A task as the plan source gives it. `fundedBySponsorId` is the tasks table's funded_by_sponsor_id;
// `invoiceOfSponsorId` marks the task that stands for that sponsor's PayPal invoice.
export type SourceTask = Omit<PlanTaskConfig, 'waitingOn'> & {
  fundedBySponsorId?: string | null;
  invoiceOfSponsorId?: string;
};

const invoiceStatus: Record<SponsorStatus, Status> = {
  pledged: 'pending',
  invoiced: 'progress',
  paid: 'done',
  cancelled: 'blocked',
};

// PRD §8: purchases a sponsor funds stay blocked until that sponsor's invoice is paid
// (INVOICING.INVOICE.PAID). The rules engine is what actually refuses the spend; this only shows it.
// A task that already happened keeps its status, and an unknown sponsor counts as unpaid.
export function gateBySponsor(tasks: SourceTask[], sponsors: PlanSponsor[]): PlanTaskConfig[] {
  const byId = new Map(sponsors.map((sponsor) => [sponsor.id, sponsor]));
  return tasks.map(({ fundedBySponsorId, invoiceOfSponsorId, ...task }) => {
    if (invoiceOfSponsorId) {
      const sponsor = byId.get(invoiceOfSponsorId);
      const status = sponsor ? invoiceStatus[sponsor.status] : 'pending';
      return { ...task, status, percentDone: status === 'done' ? 100 : task.percentDone, waitingOn: null };
    }
    if (!fundedBySponsorId || task.status === 'done') return { ...task, waitingOn: null };
    const sponsor = byId.get(fundedBySponsorId);
    if (sponsor?.status === 'paid') return { ...task, waitingOn: null };
    return { ...task, status: 'blocked', waitingOn: sponsor?.name ?? 'a sponsor' };
  });
}

// The words for a task's status in the Gantt's Status column.
export function statusText(status: Status, waitingOn: string | null): string {
  if (status === 'blocked' && waitingOn) return `Waiting on ${waitingOn}`;
  return { done: 'Done', progress: 'In progress', pending: 'Not started', risk: 'Late delivery', blocked: 'Blocked' }[status];
}
