import { useEffect, useMemo, useState } from 'react';
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from 'ag-studio';
import './budget-burn.css';
import { capNote, describeBar, toBars, totalsOf, type BurnKeys } from './burn';
import { formatDollars } from './thermometer';

// The four slots a budget burn widget is mapped to. Each holds fields from one table of the command
// center's data sources (see ../studio-data.ts). The cap is optional.
export type BudgetBurnWidget = AgWidgetData<
  { category: unknown; cap: unknown; spent: unknown; committed: unknown },
  AgWidgetDataFormat<unknown>
>;

// What a request found, tagged with the columns it was made for. Whether the widget is loading is worked
// out from this (no result for the current mapping yet), not stored, and a result for an old mapping is
// never shown for a new one.
type Loaded = { for: string; outcome: { rows: Record<string, unknown>[] } | 'error' };

// What each budget category has spent and committed, against its cap. Committed money is approved but not
// yet captured, so it is shown but visibly held back (hatched). A category past its cap says so in words
// and gets a line at the cap. Clicking a category cross-filters every other widget that shares its table.
export function BudgetBurn({ dataMapping, widgetApi }: AgWidgetParams<BudgetBurnWidget>) {
  const categoryField = dataMapping.category?.[0];
  const capField = dataMapping.cap?.[0];
  const spentField = dataMapping.spent?.[0];
  const committedField = dataMapping.committed?.[0];
  const mapped = Boolean(categoryField && spentField && committedField);

  const keys = useMemo<BurnKeys | null>(
    () =>
      categoryField && spentField && committedField
        ? {
            // A field's `key` is the name of its column in the rows Studio returns.
            category: categoryField.key,
            cap: capField?.key ?? null,
            spent: spentField.key,
            committed: committedField.key,
          }
        : null,
    [categoryField, capField, spentField, committedField],
  );

  const requestKey = keys
    ? [keys.category, keys.cap ?? '', keys.spent, keys.committed].join('|')
    : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const readSelection = (): string[] => {
    const found = widgetApi
      .getCrossFilterSelections()
      ?.find((s) => s.type === 'value' && s.field.key === categoryField?.key);
    return found && found.type === 'value' ? found.values.map(String) : [];
  };

  useEffect(() => {
    if (!mapped || !requestKey) return;
    const fields = [categoryField, capField, spentField, committedField].filter(
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
    // readSelection only reads from widgetApi and categoryField, which are already dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped, requestKey, categoryField, capField, spentField, committedField, widgetApi]);

  if (!mapped || !keys) {
    return <p className="lx-burn__note">Choose a category and the spent and committed amounts.</p>;
  }
  const current = loaded && loaded.for === requestKey ? loaded.outcome : null;
  if (!current) return <p className="lx-burn__note">Loading budget…</p>;
  if (current === 'error')
    return <p className="lx-burn__note">The budget figures could not be loaded.</p>;

  const bars = toBars(current.rows, keys);
  if (bars.length === 0) {
    return (
      <p className="lx-burn__note">
        No budget categories yet. Add categories when you set up the event.
      </p>
    );
  }
  const totals = totalsOf(bars);
  const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

  const toggle = (name: string) => {
    if (!categoryField) return;
    widgetApi.toggleCrossFilter({ type: 'value', field: categoryField, value: name, group: 0 });
    setSelected(readSelection());
  };

  return (
    <div className="lx-burn" role="group" aria-label="Budget by category">
      <p className="lx-burn__summary">
        <strong>{formatDollars(totals.used)}</strong> spent and committed
        {totals.capTotal !== null && ` of ${formatDollars(totals.capTotal)} in category caps`}
      </p>
      {totals.overCount > 0 && (
        <p className="lx-burn__alert" role="status">
          {totals.overCount === 1
            ? '1 category is over its cap'
            : `${totals.overCount} categories are over their cap`}
        </p>
      )}
      <ul className="lx-burn__legend" aria-label="Legend">
        <li>
          <span className="lx-burn__swatch lx-burn__swatch--spent" aria-hidden="true" />
          Spent, captured by PayPal
        </li>
        <li>
          <span className="lx-burn__swatch lx-burn__swatch--committed" aria-hidden="true" />
          Committed, approved not yet captured
        </li>
        <li>
          <span className="lx-burn__swatch lx-burn__swatch--cap" aria-hidden="true" />
          Cap, drawn when exceeded
        </li>
      </ul>
      <ul className="lx-burn__list">
        {bars.map((bar) => {
          const isSelected = selected.includes(bar.category);
          const verdict = capNote(bar);
          return (
            <li key={bar.category}>
              <button
                type="button"
                className="lx-burn__row"
                aria-pressed={isSelected}
                aria-label={describeBar(bar)}
                data-dimmed={selected.length > 0 && !isSelected}
                onClick={() => toggle(bar.category)}
              >
                <span className="lx-burn__name">{bar.category}</span>
                <span className="lx-burn__lane" aria-hidden="true">
                  <span className="lx-burn__track" style={{ width: percent(bar.trackShare) }}>
                    <span
                      className="lx-burn__seg lx-burn__seg--spent"
                      style={{ width: percent(bar.spentShare) }}
                    />
                    <span
                      className="lx-burn__seg lx-burn__seg--committed"
                      style={{ width: percent(bar.committedShare) }}
                    />
                    {bar.over && bar.capShare !== null && (
                      <span className="lx-burn__capmark" style={{ left: percent(bar.capShare) }} />
                    )}
                  </span>
                </span>
                <span className="lx-burn__figures">
                  {formatDollars(bar.used)}
                  {bar.cap !== null && (
                    <span className="lx-burn__of"> of {formatDollars(bar.cap)}</span>
                  )}
                </span>
                <span className="lx-burn__verdict" data-tone={verdict.tone}>
                  {verdict.text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
