import { describe, expect, it } from 'vitest';
import { demoSponsors, demoTasks, HARBOR } from './demoPlan';
import { gateBySponsor, statusText, type PlanSponsor, type SourceTask } from './gating';

const sponsor = (status: PlanSponsor['status']): PlanSponsor => ({ id: 's1', name: 'Harbor Cloud', status });
const funded: SourceTask = { id: 1, name: 'Order swag', status: 'pending', fundedBySponsorId: 's1' };
const invoice: SourceTask = { id: 2, name: 'Invoice', status: 'pending', invoiceOfSponsorId: 's1' };

describe('gateBySponsor', () => {
  it('blocks a purchase until its sponsor has paid, and names the sponsor', () => {
    expect(gateBySponsor([funded], [sponsor('invoiced')])[0]).toMatchObject({ status: 'blocked', waitingOn: 'Harbor Cloud' });
    expect(gateBySponsor([funded], [sponsor('pledged')])[0]).toMatchObject({ status: 'blocked' });
  });

  it('releases the purchase once the invoice is paid', () => {
    expect(gateBySponsor([funded], [sponsor('paid')])[0]).toMatchObject({ status: 'pending', waitingOn: null });
  });

  it('treats an unknown sponsor as unpaid', () => {
    expect(gateBySponsor([funded], [])[0]).toMatchObject({ status: 'blocked', waitingOn: 'a sponsor' });
  });

  it('leaves done tasks and unfunded tasks alone', () => {
    const done = { ...funded, status: 'done' as const };
    const plain: SourceTask = { id: 3, name: 'Volunteer briefing', status: 'progress' };
    expect(gateBySponsor([done, plain], [sponsor('invoiced')]).map((t) => t.status)).toEqual(['done', 'progress']);
  });

  it("follows the sponsor's status on the invoice task", () => {
    expect(gateBySponsor([invoice], [sponsor('invoiced')])[0]).toMatchObject({ status: 'progress' });
    expect(gateBySponsor([invoice], [sponsor('paid')])[0]).toMatchObject({ status: 'done', percentDone: 100 });
  });

  it('drops the source-only fields before the tasks reach the Gantt', () => {
    const [task] = gateBySponsor([funded], [sponsor('paid')]);
    expect(task).not.toHaveProperty('fundedBySponsorId');
  });
});

describe('the sample plan', () => {
  it('has the 15 linked tasks the demo needs, with Harbor Cloud holding two purchases', () => {
    const tasks = gateBySponsor(demoTasks, demoSponsors);
    expect(tasks).toHaveLength(15);
    expect(tasks.filter((t) => t.waitingOn === 'Harbor Cloud')).toHaveLength(2);
    const paid = demoSponsors.map((s) => (s.id === HARBOR ? { ...s, status: 'paid' as const } : s));
    expect(gateBySponsor(demoTasks, paid).filter((t) => t.waitingOn === 'Harbor Cloud')).toHaveLength(0);
  });
});

describe('statusText', () => {
  it('says who a blocked task is waiting on', () => {
    expect(statusText('blocked', 'Lumen Labs')).toBe('Waiting on Lumen Labs');
    expect(statusText('risk', null)).toBe('Late delivery');
  });
});
