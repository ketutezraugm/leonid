import { useEffect, useMemo, useState } from 'react';
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from 'ag-studio';
import './funding-thermometer.css';
import { describeBar, formatDollars, toBars, totalsOf, type ThermometerKeys } from './thermometer';

// The four slots a funding thermometer is mapped to. Each holds fields from one table of the command
// center's data sources (see ../studio-data.ts).
export type FundingThermometerWidget = AgWidgetData<
  { sponsor: unknown; pledged: unknown; invoiced: unknown; cleared: unknown },
  AgWidgetDataFormat<unknown>
>;

// What a request found, tagged with the columns it was made for. Whether the widget is loading is worked
// out from this (no result for the current mapping yet), not stored, and a result for an old mapping is
// never shown for a new one.
type Loaded = { for: string; outcome: { rows: Record<string, unknown>[] } | 'error' };

// Pledged, invoiced and cleared money per sponsor. Only cleared money is spendable, so it is the solid bar;
// invoiced and pledged money is shown but visibly held back (solid amber, then hatched). Clicking a sponsor
// cross-filters every other widget that shares its table.
export function FundingThermometer({
  dataMapping,
  widgetApi,
}: AgWidgetParams<FundingThermometerWidget>) {
  const sponsorField = dataMapping.sponsor?.[0];
  const pledgedField = dataMapping.pledged?.[0];
  const invoicedField = dataMapping.invoiced?.[0];
  const clearedField = dataMapping.cleared?.[0];
  const mapped = Boolean(sponsorField && pledgedField && invoicedField && clearedField);

  const keys = useMemo<ThermometerKeys | null>(
    () =>
      sponsorField && pledgedField && invoicedField && clearedField
        ? {
            // A field's `key` is the name of its column in the rows Studio returns.
            sponsor: sponsorField.key,
            pledged: pledgedField.key,
            invoiced: invoicedField.key,
            cleared: clearedField.key,
          }
        : null,
    [sponsorField, pledgedField, invoicedField, clearedField],
  );

  const requestKey = keys ? Object.values(keys).join('|') : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const readSelection = (): string[] => {
    const found = widgetApi
      .getCrossFilterSelections()
      ?.find((s) => s.type === 'value' && s.field.key === sponsorField?.key);
    return found && found.type === 'value' ? found.values.map(String) : [];
  };

  useEffect(() => {
    if (!mapped || !requestKey) return;
    const fields = [sponsorField, pledgedField, invoicedField, clearedField].filter(
      (f): f is NonNullable<typeof f> => Boolean(f),
    );
    let live = true;
    widgetApi
      .getData({ fields })
      .then((res) => {
        if (live) {
          setLoaded({ for: requestKey, outcome: { rows: res.results.rows } });
          setSelected(readSelection());
        }
      })
      .catch(() => {
        if (live) setLoaded({ for: requestKey, outcome: 'error' });
      });
    return () => {
      live = false;
    };
    // readSelection only reads from widgetApi and sponsorField, which are already dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped, requestKey, sponsorField, pledgedField, invoicedField, clearedField, widgetApi]);

  if (!mapped || !keys) {
    return (
      <p className="lx-thermo__note">
        Choose a sponsor and the pledged, invoiced and cleared amounts.
      </p>
    );
  }
  const current = loaded && loaded.for === requestKey ? loaded.outcome : null;
  if (!current) return <p className="lx-thermo__note">Loading funding…</p>;
  if (current === 'error')
    return <p className="lx-thermo__note">The funding figures could not be loaded.</p>;

  const bars = toBars(current.rows, keys);
  if (bars.length === 0) {
    return (
      <p className="lx-thermo__note">
        No sponsors yet. Draft your sponsor invoices to start the thermometer.
      </p>
    );
  }
  const totals = totalsOf(bars);
  const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

  const toggle = (name: string) => {
    if (!sponsorField) return;
    widgetApi.toggleCrossFilter({ type: 'value', field: sponsorField, value: name, group: 0 });
    setSelected(readSelection());
  };

  return (
    <div className="lx-thermo" role="group" aria-label="Funding by sponsor">
      <p className="lx-thermo__summary">
        <strong>{formatDollars(totals.cleared)}</strong> cleared of {formatDollars(totals.pledged)}{' '}
        pledged
      </p>
      <ul className="lx-thermo__legend" aria-label="Legend">
        <li>
          <span className="lx-thermo__swatch lx-thermo__swatch--cleared" aria-hidden="true" />
          Cleared, spendable
        </li>
        <li>
          <span className="lx-thermo__swatch lx-thermo__swatch--outstanding" aria-hidden="true" />
          Invoiced, not yet paid
        </li>
        <li>
          <span className="lx-thermo__swatch lx-thermo__swatch--uninvoiced" aria-hidden="true" />
          Pledged, not yet invoiced
        </li>
      </ul>
      <ul className="lx-thermo__list">
        {bars.map((bar) => {
          const isSelected = selected.includes(bar.name);
          return (
            <li key={bar.name}>
              <button
                type="button"
                className="lx-thermo__row"
                aria-pressed={isSelected}
                aria-label={describeBar(bar)}
                data-dimmed={selected.length > 0 && !isSelected}
                onClick={() => toggle(bar.name)}
              >
                <span className="lx-thermo__name">{bar.name}</span>
                <span className="lx-thermo__lane" aria-hidden="true">
                  <span className="lx-thermo__track" style={{ width: percent(bar.trackShare) }}>
                    <span
                      className="lx-thermo__seg lx-thermo__seg--cleared"
                      style={{ width: percent(bar.clearedShare) }}
                    />
                    <span
                      className="lx-thermo__seg lx-thermo__seg--outstanding"
                      style={{ width: percent(bar.outstandingShare) }}
                    />
                    <span
                      className="lx-thermo__seg lx-thermo__seg--uninvoiced"
                      style={{ width: percent(bar.uninvoicedShare) }}
                    />
                  </span>
                </span>
                <span className="lx-thermo__figures">
                  {formatDollars(bar.cleared)}{' '}
                  <span className="lx-thermo__of">of {formatDollars(bar.pledged)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
