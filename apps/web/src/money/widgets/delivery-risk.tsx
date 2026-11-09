import { useEffect, useMemo, useState } from 'react';
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from 'ag-studio';
import './delivery-risk.css';
import {
  countsOf,
  datesLine,
  describeItem,
  riskView,
  timing,
  toItems,
  type DeliveryKeys,
} from './delivery';
import { useFiltersVersion } from './filters-changed';

// The slots a delivery risk widget is mapped to, each holding a field of the command center's `deliveries`
// table (see ../studio-data.ts). The id, name and risk are required; the rest add detail.
export type DeliveryRiskWidget = AgWidgetData<
  {
    id: unknown;
    name: unknown;
    risk: unknown;
    category: unknown;
    expected: unknown;
    deadline: unknown;
    daysLate: unknown;
  },
  AgWidgetDataFormat<unknown>
>;

// What a request found, tagged with the columns it was made for. Whether the widget is loading is worked
// out from this (no result for the current mapping yet), not stored, and a result for an old mapping is
// never shown for a new one.
type Loaded = { for: string; outcome: { rows: Record<string, unknown>[] } | 'error' };

// Ordered items against their deadlines: which are late, which are close, which are on track and which have
// no delivery date yet, most urgent first. Clicking an item filters the other widgets by its category.
export function DeliveryRisk({ dataMapping, widgetApi }: AgWidgetParams<DeliveryRiskWidget>) {
  const idField = dataMapping.id?.[0];
  const nameField = dataMapping.name?.[0];
  const riskField = dataMapping.risk?.[0];
  const categoryField = dataMapping.category?.[0];
  const expectedField = dataMapping.expected?.[0];
  const deadlineField = dataMapping.deadline?.[0];
  const daysLateField = dataMapping.daysLate?.[0];
  const mapped = Boolean(idField && nameField && riskField);

  const keys = useMemo<DeliveryKeys | null>(
    () =>
      idField && nameField && riskField
        ? {
            // A field's `key` is the name of its column in the rows Studio returns.
            id: idField.key,
            name: nameField.key,
            risk: riskField.key,
            category: categoryField?.key ?? null,
            expected: expectedField?.key ?? null,
            deadline: deadlineField?.key ?? null,
            daysLate: daysLateField?.key ?? null,
          }
        : null,
    [idField, nameField, riskField, categoryField, expectedField, deadlineField, daysLateField],
  );

  const requestKey = keys
    ? [keys.id, keys.name, keys.risk, keys.category, keys.expected, keys.deadline, keys.daysLate]
        .map((k) => k ?? '')
        .join('|')
    : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // This widget lists rows, so a sponsor or category chosen in another widget has to change what it shows.
  // Studio does not say so; filters-changed.ts does. The items already on screen stay until the new ones arrive.
  const filtersVersion = useFiltersVersion();

  const readSelection = (): string[] => {
    const found = widgetApi
      .getCrossFilterSelections()
      ?.find((s) => s.type === 'value' && s.field.key === categoryField?.key);
    return found && found.type === 'value' ? found.values.map(String) : [];
  };

  useEffect(() => {
    if (!mapped || !requestKey) return;
    const fields = [
      idField,
      nameField,
      riskField,
      categoryField,
      expectedField,
      deadlineField,
      daysLateField,
    ].filter((f): f is NonNullable<typeof f> => Boolean(f));
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
  }, [
    mapped,
    requestKey,
    idField,
    nameField,
    riskField,
    categoryField,
    expectedField,
    deadlineField,
    daysLateField,
    widgetApi,
    filtersVersion,
  ]);

  if (!mapped || !keys) {
    return (
      <p className="lx-delivery__note">Choose the item, its name and its delivery risk to show.</p>
    );
  }
  const current = loaded && loaded.for === requestKey ? loaded.outcome : null;
  if (!current) return <p className="lx-delivery__note">Loading deliveries…</p>;
  if (current === 'error')
    return <p className="lx-delivery__note">The deliveries could not be loaded.</p>;

  const { items, skipped } = toItems(current.rows, keys);
  if (items.length === 0 && skipped === 0) {
    return (
      <p className="lx-delivery__note">
        No deliveries to show. Either nothing has been ordered yet, or nothing ordered matches what
        is selected in another widget.
      </p>
    );
  }
  const counts = countsOf(items);
  const tiles = [
    { risk: 'late', count: counts.late },
    { risk: 'at_risk', count: counts.atRisk },
    { risk: 'on_track', count: counts.onTrack },
    { risk: 'unknown', count: counts.unknown },
  ] as const;

  const toggle = (category: string) => {
    if (!categoryField) return;
    widgetApi.toggleCrossFilter({ type: 'value', field: categoryField, value: category, group: 0 });
    setSelected(readSelection());
  };

  return (
    <div className="lx-delivery" role="group" aria-label="Delivery risk">
      <ul className="lx-delivery__counts" aria-label="Deliveries by risk">
        {tiles.map(({ risk, count }) => (
          <li key={risk} className="lx-delivery__count" data-tone={riskView[risk].tone}>
            <span className="lx-delivery__number">{count}</span>
            <span className="lx-delivery__label">
              <span className="lx-delivery__dot" aria-hidden="true" />
              {riskView[risk].label}
            </span>
          </li>
        ))}
      </ul>
      {skipped > 0 && (
        <p className="lx-delivery__warn" role="status">
          {skipped === 1
            ? '1 item has a risk this widget does not recognise, so it is not counted'
            : `${skipped} items have a risk this widget does not recognise, so they are not counted`}
        </p>
      )}
      <p className="lx-delivery__scope">
        {items.length === 1 ? '1 delivery' : `${items.length} deliveries`}, most urgent first
      </p>
      <ul className="lx-delivery__list">
        {items.map((item, i) => {
          const view = riskView[item.risk];
          const category = item.category;
          const isSelected = category !== null && selected.includes(category);
          const howItStands = timing(item);
          const dates = datesLine(item);
          const body = (
            <>
              <span className="lx-delivery__head">
                <span className="lx-delivery__risk">
                  <span className="lx-delivery__dot" data-tone={view.tone} aria-hidden="true" />
                  {view.label}
                </span>
                <span className="lx-delivery__name">{item.name}</span>
                {category && <span className="lx-delivery__category">{category}</span>}
              </span>
              {howItStands && (
                <span className="lx-delivery__timing" data-tone={view.tone}>
                  {howItStands}
                </span>
              )}
              {dates && <span className="lx-delivery__dates">{dates}</span>}
            </>
          );
          return (
            <li key={`${item.id}:${i}`}>
              {category ? (
                <button
                  type="button"
                  className="lx-delivery__row"
                  aria-pressed={isSelected}
                  aria-label={describeItem(item)}
                  data-dimmed={selected.length > 0 && !isSelected}
                  onClick={() => toggle(category)}
                >
                  {body}
                </button>
              ) : (
                <div className="lx-delivery__row" role="group" aria-label={describeItem(item)}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
