import type { ClaimStatus } from '@quartermaster/shared';
import type { Status } from './StatusBadge';

// How a backend claim state reads to a volunteer, and which badge it wears. There is no volunteer "Needs info"
// state: needs_review means the treasurer is checking it, so the volunteer has nothing to do.
export const claimStatusView: Record<ClaimStatus, { label: string; status: Status }> = {
  submitted: { label: 'Submitted', status: 'pending' },
  needs_review: { label: 'Being checked', status: 'progress' },
  pending_approval: { label: 'Waiting on approval', status: 'risk' },
  approved: { label: 'Approved', status: 'progress' },
  paid: { label: 'Paid', status: 'done' },
  rejected: { label: 'Declined', status: 'blocked' },
};
