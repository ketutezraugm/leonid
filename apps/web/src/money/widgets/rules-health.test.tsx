import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportState, resetFiltersVersion, startFrom } from './filters-changed';
import { RulesHealth } from './rules-health';

type Props = Parameters<typeof RulesHealth>[0];

// Just enough of a Studio field for the widget: `key` is the column name in the result rows.
const field = (fieldId: string) => ({ type: 'column', fieldId, key: fieldId });

const categoryField = field('rules.category');
const dateField = field('rules.date');
const mapping = {
  id: [field('rules.id')],
  decision: [field('rules.decision')],
  reasons: [field('rules.reasons')],
  category: [categoryField],
  amount: [field('rules.amount')],
  date: [dateField],
};

const row = (
  id: string,
  decision: string,
  reasons: string,
  category: string | null,
  amount: number | null,
) => ({
  'rules.id': id,
  'rules.decision': decision,
  'rules.reasons': reasons,
  'rules.category': category,
  'rules.amount': amount,
  'rules.date': '2027-01-14',
});

const rows = [
  row('au_3', 'block', 'Vendor is not on the approved list', 'swag', 90),
  row('au_2', 'needs_approval', 'Over the $200 approval threshold', 'prizes', 420),
  row('au_1', 'allow', 'Under the $200 approval threshold', 'swag', 140),
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
  render(<RulesHealth {...props} />);
  return widgetApi;
}

describe('RulesHealth', () => {
  beforeEach(resetFiltersVersion);

  it('shows a loading note first, then every check with its decision, amount, category and reasons', async () => {
    setup();

    expect(screen.getByText('Loading spend checks…')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', {
        name: 'Blocked, $90.00, swag. Vendor is not on the approved list',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Sent to approval, $420.00, prizes. Over the $200 approval threshold',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Allowed, $140.00, swag. Under the $200 approval threshold',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Vendor is not on the approved list')).toBeInTheDocument();
  });

  it('counts the checks allowed, sent to approval and blocked', async () => {
    setup();

    await screen.findByRole('button', { name: /^Blocked/ });

    const tiles = within(
      screen.getByRole('list', { name: 'Spend checks by decision' }),
    ).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent)).toEqual(['1Allowed', '1Sent to approval', '1Blocked']);
    expect(screen.getByText('3 spend checks, newest first')).toBeInTheDocument();
  });

  it('counts only the checks it is given, so a filtered list shows filtered counts', async () => {
    setup({ rows: [rows[0], rows[2]] });

    await screen.findByRole('button', { name: /^Blocked/ });

    const tiles = within(
      screen.getByRole('list', { name: 'Spend checks by decision' }),
    ).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent)).toEqual(['1Allowed', '0Sent to approval', '1Blocked']);
  });

  it('asks Studio for the mapped fields, newest day first, once', async () => {
    const api = setup();

    await screen.findByRole('button', { name: /^Blocked/ });

    expect(api.getData).toHaveBeenCalledTimes(1);
    expect(api.getData).toHaveBeenCalledWith({
      fields: [
        mapping.id[0],
        mapping.decision[0],
        mapping.reasons[0],
        mapping.category[0],
        mapping.amount[0],
        dateField,
      ],
      sort: [{ field: dateField, direction: 'desc' }],
    });
  });

  it('works with only the required fields: no sort, and no row can filter by category', async () => {
    const api = setup({
      dataMapping: { id: mapping.id, decision: mapping.decision, reasons: mapping.reasons },
      rows: [{ 'rules.id': 'au_1', 'rules.decision': 'allow', 'rules.reasons': 'ok' }],
    });

    expect(await screen.findByRole('group', { name: 'Allowed. ok' })).toBeInTheDocument();
    expect(api.getData).toHaveBeenCalledWith({
      fields: [mapping.id[0], mapping.decision[0], mapping.reasons[0]],
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not make a check without a category a button, since there is nothing to filter by', async () => {
    setup({ rows: [row('au_9', 'allow', 'Fine', null, 12)] });

    expect(await screen.findByRole('group', { name: 'Allowed, $12.00. Fine' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when a check has no reasons, instead of leaving it blank', async () => {
    setup({ rows: [row('au_9', 'block', '', 'swag', 5)] });

    expect(await screen.findByText('No reason recorded')).toBeInTheDocument();
  });

  it('says so, and does not count a check, when its decision is not one the rules engine returns', async () => {
    setup({ rows: [rows[0], row('au_8', 'maybe', 'huh', 'swag', 1)] });

    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 check has a decision this widget does not recognise, so it is not counted',
    );
    expect(screen.getByText('1 spend check, newest first')).toBeInTheDocument();
  });

  it('cross-filters by category when a check is clicked', async () => {
    const api = setup();

    fireEvent.click(await screen.findByRole('button', { name: /^Sent to approval/ }));

    expect(api.toggleCrossFilter).toHaveBeenCalledTimes(1);
    expect(api.toggleCrossFilter).toHaveBeenCalledWith({
      type: 'value',
      field: categoryField,
      value: 'prizes',
      group: 0,
    });
  });

  it('marks the checks in the selected category as pressed and dims the others', async () => {
    setup({
      selections: [{ type: 'value', group: 0, field: categoryField, values: ['prizes'] }],
    });

    const prizes = await screen.findByRole('button', { name: /^Sent to approval/ });

    expect(prizes).toHaveAttribute('aria-pressed', 'true');
    expect(prizes).toHaveAttribute('data-dimmed', 'false');
    const swag = screen.getByRole('button', { name: /^Blocked/ });
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

    expect(await screen.findByRole('button', { name: /^Blocked/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('says so, and stays quiet, when there are no checks yet', async () => {
    setup({ rows: [] });

    expect(
      await screen.findByText(
        'No spend checks to show. Either no spend has been checked yet, or none matches what is selected in another widget.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('when another widget changes the filters', () => {
    const selection = (value: string) => [
      { type: 'value', group: 0, field: { id: 'categories.category' }, values: [value] },
    ];
    const mount = (second: Promise<unknown> | unknown) => {
      const widgetApi = {
        getData: vi.fn().mockResolvedValueOnce({ results: { rows } }).mockReturnValueOnce(second),
        toggleCrossFilter: vi.fn(),
        getCrossFilterSelections: vi.fn(() => undefined),
      };
      render(<RulesHealth {...({ dataMapping: mapping, widgetApi } as unknown as Props)} />);
      return widgetApi;
    };

    it('fetches again and shows only the checks that are left', async () => {
      const api = mount(Promise.resolve({ results: { rows: [rows[1]] } }));
      await screen.findByRole('button', { name: /^Blocked/ });

      startFrom({ pages: [{ id: 'overview' }] });
      act(() => reportState({ pages: [{ id: 'overview', crossFilter: selection('prizes') }] }));

      expect(await screen.findByText('1 spend check, newest first')).toBeInTheDocument();
      expect(api.getData).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button', { name: /^Blocked/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Sent to approval/ })).toBeInTheDocument();
    });

    it('keeps the checks it has on screen while it fetches again, not a loading note', async () => {
      mount(new Promise(() => {}));
      await screen.findByRole('button', { name: /^Blocked/ });

      startFrom({ pages: [{ id: 'overview' }] });
      act(() => reportState({ pages: [{ id: 'overview', crossFilter: selection('prizes') }] }));

      expect(screen.getByRole('button', { name: /^Blocked/ })).toBeInTheDocument();
      expect(screen.queryByText('Loading spend checks…')).not.toBeInTheDocument();
    });

    it('does not fetch again for a change that is not about the filters', async () => {
      const api = mount(Promise.resolve({ results: { rows: [] } }));
      await screen.findByRole('button', { name: /^Blocked/ });

      startFrom({ pages: [{ id: 'overview' }] });
      act(() => reportState({ pages: [{ id: 'overview' }] }));

      expect(api.getData).toHaveBeenCalledTimes(1);
    });
  });

  it('says so when the checks could not be loaded', async () => {
    setup({ reject: true });

    expect(await screen.findByText('The spend checks could not be loaded.')).toBeInTheDocument();
  });

  it('asks for the fields to be chosen, without calling Studio, when the widget is not mapped', async () => {
    const api = setup({ dataMapping: {} });

    expect(screen.getByText(/Choose the check, its decision and the reasons/)).toBeInTheDocument();
    await waitFor(() => expect(api.getData).not.toHaveBeenCalled());
  });

  it('asks for the fields to be chosen when only some of the required ones are mapped', () => {
    const api = setup({ dataMapping: { id: mapping.id, decision: mapping.decision } });

    expect(screen.getByText(/Choose the check/)).toBeInTheDocument();
    expect(api.getData).not.toHaveBeenCalled();
  });

  it('shows the loading note, not the old checks, when the mapping changes to other fields', async () => {
    const widgetApi = {
      getData: vi
        .fn()
        .mockResolvedValueOnce({ results: { rows } })
        .mockReturnValueOnce(new Promise(() => {})),
      toggleCrossFilter: vi.fn(),
      getCrossFilterSelections: vi.fn(() => undefined),
    };
    const { rerender } = render(
      <RulesHealth {...({ dataMapping: mapping, widgetApi } as unknown as Props)} />,
    );
    await screen.findByRole('button', { name: /^Blocked/ });

    const other = { ...mapping, reasons: [field('rules.action')] };
    rerender(<RulesHealth {...({ dataMapping: other, widgetApi } as unknown as Props)} />);

    expect(await screen.findByText('Loading spend checks…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Blocked/ })).not.toBeInTheDocument();
    expect(widgetApi.getData).toHaveBeenCalledTimes(2);
  });
});
