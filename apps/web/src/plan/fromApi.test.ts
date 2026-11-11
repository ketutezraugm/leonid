import type { PlanResponse, PlanTaskRow } from '@leonid/shared';
import { describe, expect, it } from 'vitest';
import { taskStatus, toPlanSource } from './fromApi';

const row = (over: Partial<PlanTaskRow> = {}): PlanTaskRow => ({
  id: 't1',
  name: 'Order swag',
  start: '2027-02-01T00:00:00.000Z',
  end: '2027-02-02T23:59:59.000Z',
  deadline: null,
  dependsOn: [],
  fundedBySponsorId: null,
  invoiceOfSponsorId: null,
  ...over,
});
const at = (iso: string) => new Date(iso);

describe('taskStatus', () => {
  it('follows the clock', () => {
    expect(taskStatus(row(), at('2027-01-20T00:00:00Z'))).toBe('pending');
    expect(taskStatus(row(), at('2027-02-02T00:00:00Z'))).toBe('progress');
    expect(taskStatus(row(), at('2027-02-10T00:00:00Z'))).toBe('done');
  });

  it('flags a task close to its deadline as at risk and one past it as late', () => {
    const now = at('2027-01-20T00:00:00Z');
    expect(taskStatus(row({ deadline: '2027-02-04T23:59:59.000Z' }), now)).toBe('risk');
    expect(taskStatus(row({ deadline: '2027-03-01T23:59:59.000Z' }), now)).toBe('pending');
    expect(taskStatus(row({ deadline: '2027-02-01T23:59:59.000Z' }), now)).toBe('blocked');
  });
});

describe('toPlanSource', () => {
  const plan: PlanResponse = {
    eventDate: '2027-03-14T09:00:00.000Z',
    tasks: [row(), row({ id: 't2', name: 'Swag delivery', dependsOn: ['t1', 'gone'] })],
  };

  it("turns an event's own tasks into Gantt tasks and links", () => {
    const source = toPlanSource(plan, at('2027-01-01T00:00:00Z'));
    expect(source.tasks.map((t) => t.name)).toEqual(['Order swag', 'Swag delivery']);
    expect(source.tasks[0]).toMatchObject({ startDate: '2027-02-01', endDate: '2027-02-03' });
    expect(source.dependencies).toEqual([{ id: 't1>t2', from: 't1', to: 't2' }]);
    expect(source.eventDay).toBe('2027-03-14');
  });

  it('shows a week before the first date and two after event day', () => {
    const source = toPlanSource(plan);
    expect(source.startDate).toBe('2027-01-25');
    expect(source.endDate).toBe('2027-03-28');
  });
});
