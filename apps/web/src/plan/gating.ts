import type { SponsorStatus } from '@leonid/shared';
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
export type SourceTask = Omit<PlanTaskConfig, 'fundedBy' | 'fundedByPaid'> & {
  fundedBySponsorId?: string | null;
  invoiceOfSponsorId?: string;
};

export const invoiceStatus: Record<SponsorStatus, Status> = {
  pledged: 'pending',
  invoiced: 'progress',
  paid: 'done',
  cancelled: 'blocked',
};

// Which sponsor funds each purchase, and whether that sponsor has paid. Since Nov 6 there is no sponsor gate
// (the organizer's PayPal account pays), so this never blocks a task: it only labels it. Each sponsor's invoice
// task follows the sponsor's status, which INVOICING.INVOICE.PAID moves to paid.
export function applySponsors(tasks: SourceTask[], sponsors: PlanSponsor[]): PlanTaskConfig[] {
  const byId = new Map(sponsors.map((sponsor) => [sponsor.id, sponsor]));
  return tasks.map(({ fundedBySponsorId, invoiceOfSponsorId, ...task }) => {
    if (invoiceOfSponsorId) {
      const sponsor = byId.get(invoiceOfSponsorId);
      const status = sponsor ? invoiceStatus[sponsor.status] : 'pending';
      return {
        ...task,
        status,
        percentDone: status === 'done' ? 100 : task.percentDone,
        fundedBy: null,
        fundedByPaid: false,
      };
    }
    const sponsor = fundedBySponsorId ? byId.get(fundedBySponsorId) : undefined;
    return { ...task, fundedBy: sponsor?.name ?? null, fundedByPaid: sponsor?.status === 'paid' };
  });
}

// The words for a task's status in the Gantt's Status column. Red is kept for deliveries: at risk means two
// days or fewer to spare before the deadline, late means past it (the delivery-risk wording agreed with P3).
export const statusLabel: Record<Status, string> = {
  done: 'Done',
  progress: 'In progress',
  pending: 'Not started',
  risk: 'At risk',
  blocked: 'Late',
};

// The Funded by column: the sponsor, and whether their money has arrived yet.
export function fundingText(fundedBy: string | null, paid: boolean): string {
  if (!fundedBy) return '';
  return `${fundedBy} · ${paid ? 'paid' : 'not paid yet'}`;
}
