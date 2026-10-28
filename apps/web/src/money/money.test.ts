import {
  BudgetBurnData,
  DeliveryRiskData,
  FundingThermometerData,
  PayoutsLedgerData,
  RulesHealthData,
} from '@quartermaster/shared';
import { describe, expect, it } from 'vitest';
import { commandCenterReport } from './initial-report';
import { sampleCommandCenterData as sample } from './sample-data';
import { buildTables } from './studio-data';

describe('sample data', () => {
  it('matches the shared widget schemas', () => {
    FundingThermometerData.parse(sample.funding);
    BudgetBurnData.parse(sample.budget);
    PayoutsLedgerData.parse(sample.payouts);
    RulesHealthData.parse(sample.rules);
    DeliveryRiskData.parse(sample.delivery);
  });

  it('keeps the funds-gated budget arithmetic: unlocked = cleared income - committed', () => {
    const { budget } = sample;
    expect(budget.unlocked).toBe(budget.clearedIncome - budget.committed);
    expect(budget.committed).toBe(budget.categories.reduce((n, c) => n + c.spent + c.committed, 0));
  });

  it('sums sponsor funding into the totals', () => {
    const { sponsors, totals } = sample.funding;
    expect(totals.pledged).toBe(sponsors.reduce((n, s) => n + s.pledged, 0));
    expect(totals.invoiced).toBe(sponsors.reduce((n, s) => n + s.invoiced, 0));
    expect(totals.cleared).toBe(sponsors.reduce((n, s) => n + s.cleared, 0));
  });

  it('counts rule decisions to match the recent checks', () => {
    const { counts, recent } = sample.rules;
    for (const decision of ['allow', 'needs_approval', 'block'] as const) {
      const key = decision === 'needs_approval' ? 'needsApproval' : decision;
      expect(recent.filter((r) => r.result.decision === decision).length).toBeLessThanOrEqual(
        counts[key],
      );
    }
  });

  it('derives days late from the dates', () => {
    for (const item of sample.delivery.items) {
      if (!item.expectedDelivery) continue;
      const days = (Date.parse(item.expectedDelivery) - Date.parse(item.deadline)) / 86_400_000;
      expect(item.daysLate).toBe(days);
    }
  });
});

describe('studio data', () => {
  const tables = buildTables(sample);

  it('converts integer cents to dollars at the presentation boundary', () => {
    const sponsors = tables.find((s) => s.id === 'sponsors');
    expect(sponsors?.data[0]).toMatchObject({ pledged: 3000, cleared: 3000, outstanding: 0 });
    expect(sponsors?.data[1]).toMatchObject({ invoiced: 2000, cleared: 0, outstanding: 2000 });
  });

  it('defines every field its rows carry', () => {
    for (const source of tables) {
      const ids = new Set(source.fields.map((f) => f.id));
      for (const key of Object.keys(source.data[0] ?? {}))
        expect(ids, `${source.id}.${key}`).toContain(key);
    }
  });

  it('only references fields that exist in the default report', () => {
    const known = new Set(tables.flatMap((s) => s.fields.map((f) => `${s.id}.${f.id}`)));
    const referenced: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        const { id } = node as { id?: unknown };
        if (typeof id === 'string' && /^[a-z]+\.[A-Za-z]+$/.test(id)) referenced.push(id);
        Object.values(node).forEach(walk);
      }
    };
    for (const page of commandCenterReport.pages) walk(page.widgets);
    expect(referenced.length).toBeGreaterThan(5);
    for (const id of referenced) expect(known, id).toContain(id);
  });

  it('places every widget on the canvas', () => {
    for (const page of commandCenterReport.pages) {
      expect(Object.keys(page.widgetLayout ?? {}).sort()).toEqual(
        Object.keys(page.widgets ?? {}).sort(),
      );
    }
  });
});
