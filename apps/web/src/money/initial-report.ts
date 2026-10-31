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

const kpi = (text: string, value: ReturnType<typeof sum>) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: title(text),
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
      format: title('Funding: pledged, invoiced and cleared'),
    } as unknown as AnyWidgetState,
    burn: {
      type: 'budget-burn',
      dataMapping: {
        category: [{ id: 'categories.category' }],
        cap: [sum('categories.cap')],
        spent: [sum('categories.spent')],
        committed: [sum('categories.committed')],
      },
      format: title('Budget burn by category'),
    } as unknown as AnyWidgetState,
    payouts: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'payouts.recipient' },
          { id: 'payouts.kind' },
          { id: 'payouts.wallet' },
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
    payouts: at(0, 31, 24, 18),
  },
};

export const commandCenterReport: AgReportState = {
  selectedPageId: overview.id,
  pages: [overview],
};
