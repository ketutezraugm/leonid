import { describe, expect, it } from 'vitest';
import {
  applySponsors,
  fundingText,
  statusLabel,
  type PlanSponsor,
  type SourceTask,
} from './gating';

const sponsor = (status: PlanSponsor['status']): PlanSponsor => ({
  id: 's1',
  name: 'Harbor Cloud',
  status,
});
const funded: SourceTask = {
  id: 1,
  name: 'Order swag',
  status: 'pending',
  fundedBySponsorId: 's1',
};
const invoice: SourceTask = { id: 2, name: 'Invoice', status: 'pending', invoiceOfSponsorId: 's1' };

describe('applySponsors', () => {
  it('labels a purchase with its sponsor and never blocks it (no sponsor gate)', () => {
    expect(applySponsors([funded], [sponsor('invoiced')])[0]).toMatchObject({
      status: 'pending',
      fundedBy: 'Harbor Cloud',
      fundedByPaid: false,
    });
    expect(applySponsors([funded], [sponsor('paid')])[0]).toMatchObject({
      status: 'pending',
      fundedByPaid: true,
    });
  });

  it('leaves unfunded tasks and unknown sponsors unlabelled', () => {
    const plain: SourceTask = { id: 3, name: 'Volunteer briefing', status: 'progress' };
    expect(applySponsors([plain, funded], []).map((t) => t.fundedBy)).toEqual([null, null]);
  });

  it("follows the sponsor's status on the invoice task", () => {
    expect(applySponsors([invoice], [sponsor('invoiced')])[0]).toMatchObject({
      status: 'progress',
    });
    expect(applySponsors([invoice], [sponsor('paid')])[0]).toMatchObject({
      status: 'done',
      percentDone: 100,
    });
  });

  it('drops the source-only fields before the tasks reach the Gantt', () => {
    const [task] = applySponsors([funded], [sponsor('paid')]);
    expect(task).not.toHaveProperty('fundedBySponsorId');
  });
});

describe('labels', () => {
  it('keeps red words for deliveries and says whether the sponsor has paid', () => {
    expect(statusLabel.blocked).toBe('Late');
    expect(statusLabel.risk).toBe('At risk');
    expect(fundingText('Lumen Labs', true)).toBe('Lumen Labs · paid');
    expect(fundingText('Pixel Foundry', false)).toBe('Pixel Foundry · not paid yet');
    expect(fundingText(null, false)).toBe('');
  });
});
