import {
  BudgetBurnData,
  DeliveryRiskData,
  FundingThermometerData,
  PayoutsLedgerData,
  RulesHealthData,
} from '@leonid/shared';
import { describe, expect, it } from 'vitest';
import { commandCenterReport } from './initial-report';
import { sampleCommandCenterData as sample } from './sample-data';
import { buildStudioData, buildTables, RELATIONSHIPS } from './studio-data';

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

  it('relates sponsors and categories to the tables they filter, by fields that exist', () => {
    const field = (tableId: string, fieldId: string) =>
      tables.find((t) => t.id === tableId)?.fields.find((f) => f.id === fieldId);
    expect(RELATIONSHIPS.map((r) => r.id)).toHaveLength(6);
    for (const rel of RELATIONSHIPS) {
      expect(field(rel.source.tableId, rel.source.fieldId), `${rel.id} source`).toBeDefined();
      expect(field(rel.target.tableId, rel.target.fieldId), `${rel.id} target`).toBeDefined();
    }
  });

  it('gives the "one" side of every relationship unique keys, or a click would filter too much', () => {
    for (const rel of RELATIONSHIPS) {
      const rows = tables.find((t) => t.id === rel.source.tableId)?.data ?? [];
      const keys = rows.map((r) => r[rel.source.fieldId]);
      expect(new Set(keys).size, rel.id).toBe(keys.length);
    }
  });

  it('only points payouts, rule checks and deliveries at sponsors and categories that exist', () => {
    const known = (tableId: string, fieldId: string) =>
      new Set(tables.find((t) => t.id === tableId)?.data.map((r) => r[fieldId]));
    for (const rel of RELATIONSHIPS) {
      const valid = known(rel.source.tableId, rel.source.fieldId);
      const rows = tables.find((t) => t.id === rel.target.tableId)?.data ?? [];
      for (const row of rows) {
        const value = row[rel.target.fieldId];
        // A claim or a sponsor-less spend has no sponsor, which is allowed; a made-up one is not.
        if (value !== null) expect(valid, `${rel.id}: ${String(value)}`).toContain(value);
      }
    }
  });

  it('shows money fields with the currency symbol', () => {
    const money = tables.flatMap((s) => s.fields).filter((f) => f.format === 'currencyFormat');
    expect(money.length).toBeGreaterThan(5);
    for (const field of money) {
      const formatter = (field.formatOptions as { format: Intl.NumberFormat }).format;
      expect(formatter.format(3000), field.id).toBe('$3,000.00');
    }
  });

  it('places every widget on the canvas', () => {
    for (const page of commandCenterReport.pages) {
      expect(Object.keys(page.widgetLayout ?? {}).sort()).toEqual(
        Object.keys(page.widgets ?? {}).sort(),
      );
    }
  });
});

describe('cross-filtering', () => {
  const widgets = commandCenterReport.pages[0]?.widgets ?? {};
  const crossFilterOf = (id: string) =>
    (widgets[id]?.format as { crossFilter?: string } | undefined)?.crossFilter;

  it('keeps the event-level widgets from changing with other widgets’ selections', () => {
    // A sponsor and a category both reach the rows they filter, so without this a click on a sponsor would
    // change the category totals (and the other way round) through those rows.
    for (const id of ['kpi-cleared', 'kpi-outstanding', 'kpi-committed', 'funding', 'burn'])
      expect(crossFilterOf(id), id).toBe('none');
  });

  it('lets the widgets that list individual rows respond to a sponsor or a category', () => {
    expect(crossFilterOf('payouts')).toBeUndefined();
  });

  it('refuses a query that would inflate a sum instead of running it', () => {
    expect(buildStudioData(sample).options?.fanout).toEqual({ execute: 'prevent' });
  });
});
