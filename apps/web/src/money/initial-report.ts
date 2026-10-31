import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

// Field ids ('sponsors.cleared') refer to the data sources in ./studio-data.ts; money.test.ts checks that they exist.
// The canvas is 24 columns wide: at(x, y, width, height) in tracks.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
// A custom widget's state is not part of Studio's default registry types, so it is cast to the general shape.
type AnyWidgetState = NonNullable<NonNullable<AgPageState['widgets']>[string]>;

const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });

// Sponsors and budget categories both relate to the rows they filter (payouts, rule checks, deliveries), which
// would let a click on a sponsor reach the category totals through those rows, or the other way round, and a
// category total is not a sponsor's. So the event-level widgets ignore other widgets' selections; only the
// widgets that list individual rows respond to them.
const eventLevel = { crossFilter: 'none' as const };

const kpi = (text: string, value: ReturnType<typeof sum>) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: { ...title(text), ...eventLevel },
});

const overview: AgPageState = {
  id: 'overview',
  widgets: {
    'kpi-cleared': kpi('Cleared sponsor funds', sum('sponsors.cleared')),
    'kpi-outstanding': kpi('Invoiced, not yet paid', sum('sponsors.outstanding')),
    'kpi-committed': kpi('Spent and committed', sum('categories.used')),
    funding: {
      type: 'funding-thermometer',
      dataMapping: {
        sponsor: [{ id: 'sponsors.name' }],
        pledged: [sum('sponsors.pledged')],
        invoiced: [sum('sponsors.invoiced')],
        cleared: [sum('sponsors.cleared')],
      },
      format: { ...title('Funding: pledged, invoiced and cleared'), ...eventLevel },
    } as unknown as AnyWidgetState,
    burn: {
      type: 'budget-burn',
      dataMapping: {
        category: [{ id: 'categories.category' }],
        cap: [sum('categories.cap')],
        spent: [sum('categories.spent')],
        committed: [sum('categories.committed')],
      },
      format: { ...title('Budget burn by category'), ...eventLevel },
    } as unknown as AnyWidgetState,
    // Lists the checks themselves, so it responds to a sponsor or a category selected in another widget. Its
    // category is the budget category's, not the rules table's own column: a click then filters from the
    // category down to every table that lists rows, instead of leaking up through one of them.
    rules: {
      type: 'rules-health',
      dataMapping: {
        id: [{ id: 'rules.id' }],
        decision: [{ id: 'rules.decision' }],
        reasons: [{ id: 'rules.reasons' }],
        category: [{ id: 'categories.category' }],
        amount: [sum('rules.amount')],
        date: [{ id: 'rules.day' }],
      },
      format: title('Rules health'),
    } as unknown as AnyWidgetState,
    // Lists the ordered items, so it responds to a sponsor or a category selected in another widget. Its category
    // is the budget category's, for the same reason as in the rules widget.
    delivery: {
      type: 'delivery-risk',
      dataMapping: {
        id: [{ id: 'deliveries.id' }],
        name: [{ id: 'deliveries.name' }],
        risk: [{ id: 'deliveries.risk' }],
        category: [{ id: 'categories.category' }],
        expected: [{ id: 'deliveries.expectedDay' }],
        deadline: [{ id: 'deliveries.deadlineDay' }],
        daysLate: [sum('deliveries.daysLate')],
      },
      format: title('Delivery risk'),
    } as unknown as AnyWidgetState,
    payouts: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'payouts.recipient' },
          { id: 'payouts.kind' },
          { id: 'payouts.country' },
          sum('payouts.amount'),
          { id: 'payouts.status' },
        ],
      },
      format: title('Payouts ledger'),
    },
  },
  widgetLayout: {
    'kpi-cleared': at(0, 0, 8, 7),
    'kpi-outstanding': at(8, 0, 8, 7),
    'kpi-committed': at(16, 0, 8, 7),
    funding: at(0, 7, 12, 24),
    burn: at(12, 7, 12, 24),
    rules: at(0, 31, 12, 18),
    delivery: at(12, 31, 12, 18),
    payouts: at(0, 49, 24, 18),
  },
};

export const commandCenterReport: AgReportState = {
  selectedPageId: overview.id,
  pages: [overview],
};
