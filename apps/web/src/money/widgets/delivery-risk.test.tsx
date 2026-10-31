import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryRisk } from './delivery-risk';
import { reportState, resetFiltersVersion, startFrom } from './filters-changed';

type Props = Parameters<typeof DeliveryRisk>[0];

// Just enough of a Studio field for the widget: `key` is the column name in the result rows.
const field = (fieldId: string, aggregation?: string) => ({
  type: aggregation ? 'implicitMeasure' : 'column',
  fieldId,
  key: aggregation ? `${fieldId}.${aggregation}` : fieldId,
});

const categoryField = field('categories.category');
const mapping = {
  id: [field('deliveries.id')],
  name: [field('deliveries.name')],
  risk: [field('deliveries.risk')],
  category: [categoryField],
  expected: [field('deliveries.expectedDay')],
  deadline: [field('deliveries.deadlineDay')],
  daysLate: [field('deliveries.daysLate', 'sum')],
};

const row = (
  id: string,
  name: string,
  risk: string,
  category: string | null,
  expected: string | null,
  deadline: string | null,
  daysLate: number,
) => ({
  'deliveries.id': id,
  'deliveries.name': name,
  'deliveries.risk': risk,
  'categories.category': category,
  'deliveries.expectedDay': expected,
  'deliveries.deadlineDay': deadline,
  'deliveries.daysLate.sum': daysLate,
});

const rows = [
  row('or_3', 'Snacks', 'on_track', 'food', '2027-03-10', '2027-03-13', -3),
  row('or_1', 'Lanyards', 'late', 'swag', '2027-03-03', '2027-03-01', 2),
  row('or_2', 'USB-C adapters', 'at_risk', 'swag', '2027-03-01', '2027-03-01', 0),
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
  render(<DeliveryRisk {...props} />);
  return widgetApi;
}

describe('DeliveryRisk', () => {
  beforeEach(resetFiltersVersion);

  it('shows a loading note first, then every item with its risk, timing, days and category', async () => {
    setup();

    expect(screen.getByText('Loading deliveries…')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', {
        name: 'Lanyards: Late. 2 days late. Expected 2027-03-03, needed by 2027-03-01. Category swag',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'USB-C adapters: At risk. Arrives on the deadline. Expected 2027-03-01, needed by 2027-03-01. Category swag',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Snacks: On track. 3 days to spare. Expected 2027-03-10, needed by 2027-03-13. Category food',
      }),
    ).toBeInTheDocument();
  });

  it('lists the most urgent item first', async () => {
    setup();

    const buttons = await screen.findAllByRole('button');

    expect(buttons.map((b) => b.getAttribute('aria-label')?.split(':')[0])).toEqual([
      'Lanyards',
      'USB-C adapters',
      'Snacks',
    ]);
    expect(screen.getByText('3 deliveries, most urgent first')).toBeInTheDocument();
  });

  it('counts the items late, at risk, on track and with no date', async () => {
    setup();

    await screen.findByRole('button', { name: /^Lanyards/ });

    const tiles = within(screen.getByRole('list', { name: 'Deliveries by risk' })).getAllByRole(
      'listitem',
    );
    expect(tiles.map((t) => t.textContent)).toEqual([
      '1Late',
      '1At risk',
      '1On track',
      '0No date yet',
    ]);
  });

  it('counts only the items it is given, so a filtered list shows filtered counts', async () => {
    setup({ rows: [rows[1]] });

    await screen.findByRole('button', { name: /^Lanyards/ });

    const tiles = within(screen.getByRole('list', { name: 'Deliveries by risk' })).getAllByRole(
      'listitem',
    );
    expect(tiles.map((t) => t.textContent)).toEqual([
      '1Late',
      '0At risk',
      '0On track',
      '0No date yet',
    ]);
  });

  it('says an item with no date has no date, not that it arrives on the deadline', async () => {
    setup({ rows: [row('or_9', 'Banners', 'unknown', 'swag', null, '2027-03-05', 0)] });

    expect(await screen.findAllByText('No delivery date yet')).not.toHaveLength(0);
    expect(screen.queryByText('Arrives on the deadline')).not.toBeInTheDocument();
    expect(screen.getByText('Needed by 2027-03-05')).toBeInTheDocument();
  });

  it('asks Studio for the mapped fields, once', async () => {
    const api = setup();

    await screen.findByRole('button', { name: /^Lanyards/ });

    expect(api.getData).toHaveBeenCalledTimes(1);
    expect(api.getData).toHaveBeenCalledWith({
      fields: [
        mapping.id[0],
        mapping.name[0],
        mapping.risk[0],
        mapping.category[0],
        mapping.expected[0],
        mapping.deadline[0],
        mapping.daysLate[0],
      ],
    });
  });

  it('works with only the required fields: it says what it knows, and nothing can filter by category', async () => {
    const api = setup({
      dataMapping: { id: mapping.id, name: mapping.name, risk: mapping.risk },
      rows: [{ 'deliveries.id': 'or_1', 'deliveries.name': 'Lanyards', 'deliveries.risk': 'late' }],
    });

    expect(await screen.findByRole('group', { name: 'Lanyards: Late' })).toBeInTheDocument();
    expect(api.getData).toHaveBeenCalledWith({
      fields: [mapping.id[0], mapping.name[0], mapping.risk[0]],
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not make an item without a category a button, since there is nothing to filter by', async () => {
    setup({ rows: [row('or_9', 'Banners', 'on_track', null, '2027-03-01', '2027-03-05', -4)] });

    expect(
      await screen.findByRole('group', {
        name: 'Banners: On track. 4 days to spare. Expected 2027-03-01, needed by 2027-03-05',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so, and does not count an item, when its risk is not one the API returns', async () => {
    setup({ rows: [rows[1], row('or_8', 'Odd', 'soon', 'swag', null, null, 0)] });

    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 item has a risk this widget does not recognise, so it is not counted',
    );
    expect(screen.getByText('1 delivery, most urgent first')).toBeInTheDocument();
  });

  it('cross-filters by category when an item is clicked', async () => {
    const api = setup();

    fireEvent.click(await screen.findByRole('button', { name: /^Snacks/ }));

    expect(api.toggleCrossFilter).toHaveBeenCalledTimes(1);
    expect(api.toggleCrossFilter).toHaveBeenCalledWith({
      type: 'value',
      field: categoryField,
      value: 'food',
      group: 0,
    });
  });

  it('marks the items in the selected category as pressed and dims the others', async () => {
    setup({
      selections: [{ type: 'value', group: 0, field: categoryField, values: ['food'] }],
    });

    const snacks = await screen.findByRole('button', { name: /^Snacks/ });

    expect(snacks).toHaveAttribute('aria-pressed', 'true');
    expect(snacks).toHaveAttribute('data-dimmed', 'false');
    const lanyards = screen.getByRole('button', { name: /^Lanyards/ });
    expect(lanyards).toHaveAttribute('aria-pressed', 'false');
    expect(lanyards).toHaveAttribute('data-dimmed', 'true');
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
      selections: [{ type: 'value', group: 0, field: field('sponsors.name'), values: ['food'] }],
    });

    expect(await screen.findByRole('button', { name: /^Snacks/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('says so, and stays quiet, when there is nothing to show', async () => {
    setup({ rows: [] });

    expect(
      await screen.findByText(
        'No deliveries to show. Either nothing has been ordered yet, or nothing ordered matches what is selected in another widget.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when the deliveries could not be loaded', async () => {
    setup({ reject: true });

    expect(await screen.findByText('The deliveries could not be loaded.')).toBeInTheDocument();
  });

  it('asks for the fields to be chosen, without calling Studio, when the widget is not mapped', async () => {
    const api = setup({ dataMapping: {} });

    expect(
      screen.getByText('Choose the item, its name and its delivery risk to show.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.getData).not.toHaveBeenCalled());
  });

  it('asks for the fields to be chosen when only some of the required ones are mapped', () => {
    const api = setup({ dataMapping: { id: mapping.id, name: mapping.name } });

    expect(screen.getByText(/Choose the item/)).toBeInTheDocument();
    expect(api.getData).not.toHaveBeenCalled();
  });

  it('shows the loading note, not the old items, when the mapping changes to other fields', async () => {
    const widgetApi = {
      getData: vi
        .fn()
        .mockResolvedValueOnce({ results: { rows } })
        .mockReturnValueOnce(new Promise(() => {})),
      toggleCrossFilter: vi.fn(),
      getCrossFilterSelections: vi.fn(() => undefined),
    };
    const { rerender } = render(
      <DeliveryRisk {...({ dataMapping: mapping, widgetApi } as unknown as Props)} />,
    );
    await screen.findByRole('button', { name: /^Lanyards/ });

    const other = { ...mapping, name: [field('deliveries.risk')] };
    rerender(<DeliveryRisk {...({ dataMapping: other, widgetApi } as unknown as Props)} />);

    expect(await screen.findByText('Loading deliveries…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Lanyards/ })).not.toBeInTheDocument();
    expect(widgetApi.getData).toHaveBeenCalledTimes(2);
  });

  describe('when another widget changes the filters', () => {
    const selection = (value: string) => ({
      values: {
        funding: [{ type: 'value', group: 0, field: { id: 'sponsors.name' }, values: [value] }],
      },
    });
    const mount = (second: Promise<unknown> | unknown) => {
      const widgetApi = {
        getData: vi.fn().mockResolvedValueOnce({ results: { rows } }).mockReturnValueOnce(second),
        toggleCrossFilter: vi.fn(),
        getCrossFilterSelections: vi.fn(() => undefined),
      };
      render(<DeliveryRisk {...({ dataMapping: mapping, widgetApi } as unknown as Props)} />);
      return widgetApi;
    };

    it('fetches again and shows only the items that are left', async () => {
      const api = mount(Promise.resolve({ results: { rows: [rows[1]] } }));
      await screen.findByRole('button', { name: /^Snacks/ });

      startFrom({ pages: [{ id: 'overview' }] });
      act(() => reportState({ pages: [{ id: 'overview', crossFilter: selection('Alder Labs') }] }));

      expect(await screen.findByText('1 delivery, most urgent first')).toBeInTheDocument();
      expect(api.getData).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button', { name: /^Snacks/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Lanyards/ })).toBeInTheDocument();
    });

    it('keeps the items it has on screen while it fetches again, not a loading note', async () => {
      mount(new Promise(() => {}));
      await screen.findByRole('button', { name: /^Snacks/ });

      startFrom({ pages: [{ id: 'overview' }] });
      act(() => reportState({ pages: [{ id: 'overview', crossFilter: selection('Alder Labs') }] }));

      expect(screen.getByRole('button', { name: /^Snacks/ })).toBeInTheDocument();
      expect(screen.queryByText('Loading deliveries…')).not.toBeInTheDocument();
    });

    it('does not fetch again for a change that is not about the filters', async () => {
      const api = mount(Promise.resolve({ results: { rows: [] } }));
      await screen.findByRole('button', { name: /^Snacks/ });

      startFrom({ pages: [{ id: 'overview' }] });
      act(() => reportState({ pages: [{ id: 'overview' }] }));

      expect(api.getData).toHaveBeenCalledTimes(1);
    });
  });
});
