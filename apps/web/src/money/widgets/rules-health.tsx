import { useEffect, useMemo, useState } from 'react';
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from 'ag-studio';
import './rules-health.css';
import { useFiltersVersion } from './filters-changed';
import {
  countsOf,
  decisionView,
  describeEntry,
  NO_REASON,
  toEntries,
  type HealthKeys,
} from './health';
import { formatDollars } from './thermometer';

// The slots a rules health widget is mapped to, each holding a field of the command center's `rules` table
// (see ../studio-data.ts). The id, decision and reasons are required; the rest add detail.
export type RulesHealthWidget = AgWidgetData<
  {
    id: unknown;
    decision: unknown;
    reasons: unknown;
    category: unknown;
    amount: unknown;
    date: unknown;
  },
  AgWidgetDataFormat<unknown>
>;

// What a request found, tagged with the columns it was made for. Whether the widget is loading is worked
// out from this (no result for the current mapping yet), not stored, and a result for an old mapping is
// never shown for a new one.
type Loaded = { for: string; outcome: { rows: Record<string, unknown>[] } | 'error' };

// How the rules engine judged each recent spend: how many were allowed, sent to the treasurer, or blocked,
// and why. Every check is listed with its reasons. Clicking a check filters the other widgets by its category.
export function RulesHealth({ dataMapping, widgetApi }: AgWidgetParams<RulesHealthWidget>) {
  const idField = dataMapping.id?.[0];
  const decisionField = dataMapping.decision?.[0];
  const reasonsField = dataMapping.reasons?.[0];
  const categoryField = dataMapping.category?.[0];
  const amountField = dataMapping.amount?.[0];
  const dateField = dataMapping.date?.[0];
  const mapped = Boolean(idField && decisionField && reasonsField);

  const keys = useMemo<HealthKeys | null>(
    () =>
      idField && decisionField && reasonsField
        ? {
            // A field's `key` is the name of its column in the rows Studio returns.
            id: idField.key,
            decision: decisionField.key,
            reasons: reasonsField.key,
            category: categoryField?.key ?? null,
            amount: amountField?.key ?? null,
            date: dateField?.key ?? null,
          }
        : null,
    [idField, decisionField, reasonsField, categoryField, amountField, dateField],
  );

  const requestKey = keys
    ? [keys.id, keys.decision, keys.reasons, keys.category, keys.amount, keys.date]
        .map((k) => k ?? '')
        .join('|')
    : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // This widget lists rows, so a sponsor or category chosen in another widget has to change what it shows.
  // Studio does not say so; filters-changed.ts does. The checks already on screen stay until the new ones arrive.
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
      decisionField,
      reasonsField,
      categoryField,
      amountField,
      dateField,
    ].filter((f): f is NonNullable<typeof f> => Boolean(f));
    let live = true;
    widgetApi
      // Newest first: the checks are listed by day, and Studio keeps each day's checks in the order it has them.
      .getData({
        fields,
        ...(dateField && { sort: [{ field: dateField, direction: 'desc' as const }] }),
      })
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
    decisionField,
    reasonsField,
    categoryField,
    amountField,
    dateField,
    widgetApi,
    filtersVersion,
  ]);

  if (!mapped || !keys) {
    return (
      <p className="lx-rules__note">Choose the check, its decision and the reasons to show.</p>
    );
  }
  const current = loaded && loaded.for === requestKey ? loaded.outcome : null;
  if (!current) return <p className="lx-rules__note">Loading spend checks…</p>;
  if (current === 'error')
    return <p className="lx-rules__note">The spend checks could not be loaded.</p>;

  const { entries, skipped } = toEntries(current.rows, keys);
  if (entries.length === 0 && skipped === 0) {
    return (
      <p className="lx-rules__note">
        No spend checks to show. Either no spend has been checked yet, or none matches what is
        selected in another widget.
      </p>
    );
  }
  const counts = countsOf(entries);
  const tiles = [
    { decision: 'allow', count: counts.allow },
    { decision: 'needs_approval', count: counts.needsApproval },
    { decision: 'block', count: counts.block },
  ] as const;

  const toggle = (category: string) => {
    if (!categoryField) return;
    widgetApi.toggleCrossFilter({ type: 'value', field: categoryField, value: category, group: 0 });
    setSelected(readSelection());
  };

  return (
    <div className="lx-rules" role="group" aria-label="Rules health">
      <ul className="lx-rules__counts" aria-label="Spend checks by decision">
        {tiles.map(({ decision, count }) => (
          <li key={decision} className="lx-rules__count" data-tone={decisionView[decision].tone}>
            <span className="lx-rules__number">{count}</span>
            <span className="lx-rules__label">
              <span className="lx-rules__dot" aria-hidden="true" />
              {decisionView[decision].label}
            </span>
          </li>
        ))}
      </ul>
      {skipped > 0 && (
        <p className="lx-rules__warn" role="status">
          {skipped === 1
            ? '1 check has a decision this widget does not recognise, so it is not counted'
            : `${skipped} checks have a decision this widget does not recognise, so they are not counted`}
        </p>
      )}
      <p className="lx-rules__scope">
        {entries.length === 1 ? '1 spend check' : `${entries.length} spend checks`}, newest first
      </p>
      <ul className="lx-rules__list">
        {entries.map((entry, i) => {
          const view = decisionView[entry.decision];
          const category = entry.category;
          const isSelected = category !== null && selected.includes(category);
          const body = (
            <>
              <span className="lx-rules__head">
                <span className="lx-rules__decision">
                  <span className="lx-rules__dot" data-tone={view.tone} aria-hidden="true" />
                  {view.label}
                </span>
                {entry.amount !== null && (
                  <span className="lx-rules__amount">{formatDollars(entry.amount)}</span>
                )}
                {category && <span className="lx-rules__category">{category}</span>}
              </span>
              {entry.date && <span className="lx-rules__date">{entry.date}</span>}
              <span className="lx-rules__why">{entry.reasons || NO_REASON}</span>
            </>
          );
          return (
            <li key={`${entry.id}:${i}`}>
              {category ? (
                <button
                  type="button"
                  className="lx-rules__row"
                  aria-pressed={isSelected}
                  aria-label={describeEntry(entry)}
                  data-dimmed={selected.length > 0 && !isSelected}
                  onClick={() => toggle(category)}
                >
                  {body}
                </button>
              ) : (
                <div className="lx-rules__row" role="group" aria-label={describeEntry(entry)}>
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
