import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BudgetBurn } from './budget-burn';

type Props = Parameters<typeof BudgetBurn>[0];

// Just enough of a Studio field for the widget: `key` is the column name in the result rows.
const field = (fieldId: string, aggregation?: string) => ({
  type: aggregation ? 'implicitMeasure' : 'column',
  fieldId,
  key: aggregation ? `${fieldId}.${aggregation}` : fieldId,
});

const categoryField = field('categories.category');
const mapping = {
  category: [categoryField],
  cap: [field('categories.cap', 'sum')],
  spent: [field('categories.spent', 'sum')],
  committed: [field('categories.committed', 'sum')],
};

const row = (category: string, cap: number | null, spent: number, committed: number) => ({
  'categories.category': category,
  'categories.cap.sum': cap,
  'categories.spent.sum': spent,
  'categories.committed.sum': committed,
});

const rows = [
  row('swag', 1500, 140, 0),
  row('prizes', 2000, 0, 420),
  row('venue', 2500, 0, 0),
  row('food', 1000, 0, 0),
];

function setup(
  over: { rows?: unknown[]; reject?: boolean; selections?: unknown[]; dataMapping?: object } = {},
) {
  const widgetApi = {
    getData: vi.fn(() =>
      over.reject
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ results: { rows: over.rows ?? rows } }),
    ),
    toggleCrossFilter: vi.fn(),
    getCrossFilterSelections: vi.fn(() => over.selections),
  };
  const props = { dataMapping: over.dataMapping ?? mapping, widgetApi } as unknown as Props;
  render(<BudgetBurn {...props} />);
  return widgetApi;
}

describe('BudgetBurn', () => {
  it('shows a loading note first, then a button per category with its figures in words', async () => {
    setup();

    expect(screen.getByText('Loading budget…')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', {
        name: /^swag: spent \$140\.00, committed \$0\.00, cap \$1,500\.00\. \$1,360\.00 left$/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^prizes: .*committed \$420\.00/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^venue: / })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^food: / })).toBeInTheDocument();
  });

  it('summarises what was used against the caps, with nothing over', async () => {
    setup();

    await screen.findByRole('button', { name: /^swag/ });

    expect(screen.getByText('$560.00', { selector: 'strong' }).closest('p')).toHaveTextContent(
      '$560.00 spent and committed of $7,000.00 in category caps',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says in words which categories are over their cap', async () => {
    setup({ rows: [row('av', 500, 400, 200), row('swag', 1500, 140, 0)] });

    expect(await screen.findByRole('status')).toHaveTextContent('1 category is over its cap');
    expect(screen.getByText('Over the cap by $100.00')).toBeInTheDocument();
  });

  it('counts several categories over their cap', async () => {
    setup({ rows: [row('av', 500, 600, 0), row('food', 100, 200, 0)] });

    expect(await screen.findByRole('status')).toHaveTextContent('2 categories are over their cap');
  });

  it('explains the kinds of money in a legend', async () => {
    setup();

    await screen.findByRole('button', { name: /^swag/ });

    for (const label of [
      'Spent, captured by PayPal',
      'Committed, approved not yet captured',
      'Cap, drawn when exceeded',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('asks Studio for the four mapped fields, once', async () => {
    const api = setup();

    await screen.findByRole('button', { name: /^swag/ });

    expect(api.getData).toHaveBeenCalledTimes(1);
    expect(api.getData).toHaveBeenCalledWith({
      fields: [mapping.category[0], mapping.cap[0], mapping.spent[0], mapping.committed[0]],
    });
  });

  it('works without a cap: it asks for three fields and says there is no cap', async () => {
    const withoutCap = {
      category: mapping.category,
      spent: mapping.spent,
      committed: mapping.committed,
    };
    const api = setup({
      dataMapping: withoutCap,
      rows: [
        {
          'categories.category': 'swag',
          'categories.spent.sum': 140,
          'categories.committed.sum': 0,
        },
      ],
    });

    expect(await screen.findByText('No cap set')).toBeInTheDocument();
    expect(api.getData).toHaveBeenCalledWith({
      fields: [mapping.category[0], mapping.spent[0], mapping.committed[0]],
    });
    expect(screen.getByText('$140.00', { selector: 'strong' }).closest('p')).toHaveTextContent(
      /^\$140\.00 spent and committed$/,
    );
  });

  it('cross-filters by category when a bar is clicked', async () => {
    const api = setup();

    fireEvent.click(await screen.findByRole('button', { name: /^prizes/ }));

    expect(api.toggleCrossFilter).toHaveBeenCalledTimes(1);
    expect(api.toggleCrossFilter).toHaveBeenCalledWith({
      type: 'value',
      field: categoryField,
      value: 'prizes',
      group: 0,
    });
  });

  it('marks the selected category as pressed and dims the others', async () => {
    setup({
      selections: [{ type: 'value', group: 0, field: categoryField, values: ['prizes'] }],
    });

    const prizes = await screen.findByRole('button', { name: /^prizes/ });

    expect(prizes).toHaveAttribute('aria-pressed', 'true');
    expect(prizes).toHaveAttribute('data-dimmed', 'false');
    const swag = screen.getByRole('button', { name: /^swag/ });
    expect(swag).toHaveAttribute('aria-pressed', 'false');
    expect(swag).toHaveAttribute('data-dimmed', 'true');
  });

  it('dims nothing when no category is selected', async () => {
    setup({ selections: undefined });

    for (const button of await screen.findAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveAttribute('data-dimmed', 'false');
    }
  });

  it('ignores a selection made on some other field, which is not a category selection', async () => {
    setup({
      selections: [{ type: 'value', group: 0, field: field('sponsors.name'), values: ['swag'] }],
    });

    expect(await screen.findByRole('button', { name: /^swag/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('says so, and stays quiet, when there are no categories yet', async () => {
    setup({ rows: [] });

    expect(await screen.findByText(/No budget categories yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when the figures could not be loaded', async () => {
    setup({ reject: true });

    expect(await screen.findByText('The budget figures could not be loaded.')).toBeInTheDocument();
  });

  it('asks for the fields to be chosen, without calling Studio, when the widget is not mapped', async () => {
    const api = setup({ dataMapping: {} });

    expect(
      screen.getByText(/Choose a category and the spent and committed amounts/),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.getData).not.toHaveBeenCalled());
  });

  it('asks for the fields to be chosen when only some of them are mapped', () => {
    const api = setup({ dataMapping: { category: [categoryField], spent: mapping.spent } });

    expect(screen.getByText(/Choose a category/)).toBeInTheDocument();
    expect(api.getData).not.toHaveBeenCalled();
  });

  it('shows the loading note, not the old figures, when the mapping changes to other fields', async () => {
    const widgetApi = {
      getData: vi
        .fn()
        .mockResolvedValueOnce({ results: { rows } })
        .mockReturnValueOnce(new Promise(() => {})),
      toggleCrossFilter: vi.fn(),
      getCrossFilterSelections: vi.fn(() => undefined),
    };
    const { rerender } = render(
      <BudgetBurn {...({ dataMapping: mapping, widgetApi } as unknown as Props)} />,
    );
    await screen.findByRole('button', { name: /^swag/ });

    const other = { ...mapping, spent: [field('categories.used', 'sum')] };
    rerender(<BudgetBurn {...({ dataMapping: other, widgetApi } as unknown as Props)} />);

    expect(await screen.findByText('Loading budget…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^swag/ })).not.toBeInTheDocument();
    expect(widgetApi.getData).toHaveBeenCalledTimes(2);
  });
});
