import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FundingThermometer } from './funding-thermometer';

type Props = Parameters<typeof FundingThermometer>[0];

// Just enough of a Studio field for the widget: `key` is the column name in the result rows.
const field = (fieldId: string, aggregation?: string) => ({
  type: aggregation ? 'implicitMeasure' : 'column',
  fieldId,
  key: aggregation ? `${fieldId}.${aggregation}` : fieldId,
});

const sponsorField = field('sponsors.name');
const mapping = {
  sponsor: [sponsorField],
  pledged: [field('sponsors.pledged', 'sum')],
  invoiced: [field('sponsors.invoiced', 'sum')],
  cleared: [field('sponsors.cleared', 'sum')],
};

const rows = [
  {
    'sponsors.name': 'Alder Labs',
    'sponsors.pledged.sum': 3000,
    'sponsors.invoiced.sum': 3000,
    'sponsors.cleared.sum': 3000,
  },
  {
    'sponsors.name': 'Brightwave',
    'sponsors.pledged.sum': 2000,
    'sponsors.invoiced.sum': 2000,
    'sponsors.cleared.sum': 0,
  },
  {
    'sponsors.name': 'Cobalt Works',
    'sponsors.pledged.sum': 1000,
    'sponsors.invoiced.sum': 0,
    'sponsors.cleared.sum': 0,
  },
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
  render(<FundingThermometer {...props} />);
  return widgetApi;
}

describe('FundingThermometer', () => {
  it('shows a loading note first, then a button per sponsor with their figures in words', async () => {
    setup();

    expect(screen.getByText('Loading funding…')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', {
        name: /^Alder Labs: pledged \$3,000\.00, invoiced \$3,000\.00, cleared \$3,000\.00$/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Brightwave: .*cleared \$0\.00$/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cobalt Works: / })).toBeInTheDocument();
  });

  it('summarises cleared money against the pledged total', async () => {
    setup();

    await screen.findByRole('button', { name: /Alder Labs/ });

    expect(screen.getByText('$3,000.00', { selector: 'strong' }).closest('p')).toHaveTextContent(
      '$3,000.00 cleared of $6,000.00 pledged',
    );
  });

  it('explains the three kinds of money in a legend', async () => {
    setup();

    await screen.findByRole('button', { name: /Alder Labs/ });

    for (const label of [
      'Cleared, spendable',
      'Invoiced, not yet paid',
      'Pledged, not yet invoiced',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('asks Studio for the four mapped fields, once', async () => {
    const api = setup();

    await screen.findByRole('button', { name: /Alder Labs/ });

    expect(api.getData).toHaveBeenCalledTimes(1);
    expect(api.getData).toHaveBeenCalledWith({
      fields: [mapping.sponsor[0], mapping.pledged[0], mapping.invoiced[0], mapping.cleared[0]],
    });
  });

  it('cross-filters by sponsor when a bar is clicked', async () => {
    const api = setup();

    fireEvent.click(await screen.findByRole('button', { name: /^Brightwave/ }));

    expect(api.toggleCrossFilter).toHaveBeenCalledTimes(1);
    expect(api.toggleCrossFilter).toHaveBeenCalledWith({
      type: 'value',
      field: sponsorField,
      value: 'Brightwave',
      group: 0,
    });
  });

  it('marks the selected sponsor as pressed and dims the others', async () => {
    setup({
      selections: [{ type: 'value', group: 0, field: sponsorField, values: ['Brightwave'] }],
    });

    const brightwave = await screen.findByRole('button', { name: /^Brightwave/ });

    expect(brightwave).toHaveAttribute('aria-pressed', 'true');
    expect(brightwave).toHaveAttribute('data-dimmed', 'false');
    const alder = screen.getByRole('button', { name: /^Alder Labs/ });
    expect(alder).toHaveAttribute('aria-pressed', 'false');
    expect(alder).toHaveAttribute('data-dimmed', 'true');
  });

  it('dims nothing when no sponsor is selected', async () => {
    setup({ selections: undefined });

    for (const button of await screen.findAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveAttribute('data-dimmed', 'false');
    }
  });

  it('ignores a selection made on some other field, which is not a sponsor selection', async () => {
    setup({
      selections: [
        { type: 'value', group: 0, field: field('categories.category'), values: ['Alder Labs'] },
      ],
    });

    expect(await screen.findByRole('button', { name: /^Alder Labs/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('says so, and stays quiet, when there are no sponsors yet', async () => {
    setup({ rows: [] });

    expect(await screen.findByText(/No sponsors yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when the figures could not be loaded', async () => {
    setup({ reject: true });

    expect(await screen.findByText('The funding figures could not be loaded.')).toBeInTheDocument();
  });

  it('asks for the fields to be chosen, without calling Studio, when the widget is not mapped', async () => {
    const api = setup({ dataMapping: {} });

    expect(
      screen.getByText(/Choose a sponsor and the pledged, invoiced and cleared amounts/),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.getData).not.toHaveBeenCalled());
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
      <FundingThermometer {...({ dataMapping: mapping, widgetApi } as unknown as Props)} />,
    );
    await screen.findByRole('button', { name: /^Alder Labs/ });

    const other = { ...mapping, cleared: [field('sponsors.outstanding', 'sum')] };
    rerender(<FundingThermometer {...({ dataMapping: other, widgetApi } as unknown as Props)} />);

    expect(await screen.findByText('Loading funding…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Alder Labs/ })).not.toBeInTheDocument();
    expect(widgetApi.getData).toHaveBeenCalledTimes(2);
  });

  it('asks for the fields to be chosen when only some of them are mapped', () => {
    const api = setup({ dataMapping: { sponsor: [sponsorField], pledged: mapping.pledged } });

    expect(screen.getByText(/Choose a sponsor/)).toBeInTheDocument();
    expect(api.getData).not.toHaveBeenCalled();
  });
});
