import { useMemo, useState } from 'react';
import type { VenueCandidate, VenuePick } from '@quartermaster/shared';
import type { VenueSearch } from '../chat/parts';
import { formatMoney } from '../ui/money';
import {
  filterVenues,
  fits,
  noFilters,
  perLabel,
  safeLinks,
  sortVenues,
  type VenueFilters,
  type VenueSort,
} from './venues';

const bookingLabels: Record<VenueCandidate['booking'], string> = {
  whatsapp: 'WhatsApp',
  phone: 'Phone',
  website: 'Website',
  unknown: 'Unknown',
};

function priceText(venue: VenueCandidate): string | null {
  if (!venue.price) return null;
  return `${formatMoney(venue.price.amountMinor, venue.price.currency)} ${perLabel[venue.price.per]}`;
}

const isPicked = (venue: VenueCandidate, pick: VenuePick | null) =>
  !!pick && pick.name === venue.name && venue.sourceUrls.includes(pick.sourceUrl);

export function VenueResults({
  search,
  picked = null,
  onChoose = null,
}: {
  search: VenueSearch;
  // The organizer's venue pick in this chat, if any.
  picked?: VenuePick | null;
  // Sends the pick through the chat; null while the agent is working or for an older search.
  onChoose?: ((venue: VenueCandidate) => void) | null;
}) {
  const [sort, setSort] = useState<VenueSort>('best');
  const [filters, setFilters] = useState<VenueFilters>(noFilters);
  const { candidates, headcount } = search;

  const shown = useMemo(
    () => sortVenues(filterVenues(candidates, filters, headcount), sort, headcount),
    [candidates, filters, headcount, sort],
  );

  // What each sort tab would put on top, shown under its name like a fare board.
  const tops = useMemo(() => {
    const top = (s: VenueSort) => sortVenues(candidates, s, headcount)[0];
    const cheapest = top('cheapest');
    const roomiest = top('roomiest');
    const best = top('best');
    return {
      best: best?.name ?? '',
      cheapest: (cheapest && priceText(cheapest)) ?? 'No prices listed',
      roomiest: roomiest?.capacity ? `${roomiest.capacity.value} people` : 'No capacity listed',
    };
  }, [candidates, headcount]);

  const running = search.status === 'running';
  const title = search.city ? `Venues in ${search.city}` : 'Venues';

  return (
    <div className="results">
      <header className="results-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {[headcount !== null && `${headcount} people`, search.notes]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <span className={`results-status results-status--${search.status}`} role="status">
          {running
            ? 'Searching…'
            : search.status === 'failed'
              ? 'Search failed'
              : `${candidates.length} ${candidates.length === 1 ? 'venue' : 'venues'} found`}
        </span>
      </header>

      {!running && candidates.length > 0 && !candidates.some((v) => isPicked(v, picked)) && (
        <p className="results-next" role="note">
          Pick a venue to continue. The agent then plans booking it, and you can pay its deposit
          with PayPal.
        </p>
      )}

      <p className="results-note">
        Every price and capacity is copied word for word from a venue&apos;s own web page and is
        unverified. Confirm with the venue before you commit; many only quote on WhatsApp.
      </p>

      {running ? (
        <RunningState search={search} />
      ) : search.status === 'failed' ? (
        <div className="results-empty">
          <p className="results-empty-title">The venue search stopped with an error.</p>
          <p className="muted">Ask the agent to try again, or narrow the city or headcount.</p>
        </div>
      ) : candidates.length === 0 ? (
        <div className="results-empty">
          <p className="results-empty-title">No venue could be backed by a page the agent read.</p>
          {search.summary && <p className="muted">{search.summary}</p>}
        </div>
      ) : (
        <div className="results-body">
          <Filters
            candidates={candidates}
            headcount={headcount}
            filters={filters}
            onChange={setFilters}
            shown={shown.length}
          />
          <div className="results-main">
            <div className="results-sort" role="tablist" aria-label="Sort venues">
              {(
                [
                  ['best', 'Best fit', tops.best],
                  ['cheapest', 'Lowest price', tops.cheapest],
                  ['roomiest', 'Most room', tops.roomiest],
                ] as const
              ).map(([key, label, top]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={sort === key}
                  onClick={() => setSort(key)}
                >
                  <strong>{label}</strong>
                  <span>{top}</span>
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <div className="results-empty">
                <p className="results-empty-title">No venue matches these filters.</p>
                <button type="button" className="link-button" onClick={() => setFilters(noFilters)}>
                  Clear filters
                </button>
              </div>
            ) : (
              <ol className="venue-list">
                {shown.map((venue) => (
                  <li key={venue.name + venue.sourceUrls[0]}>
                    <VenueCard
                      venue={venue}
                      headcount={headcount}
                      chosen={isPicked(venue, picked)}
                      onChoose={onChoose && (() => onChoose(venue))}
                    />
                  </li>
                ))}
              </ol>
            )}
            {search.summary && <p className="results-summary muted">{search.summary}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function RunningState({ search }: { search: VenueSearch }) {
  return (
    <div className="results-running">
      <ul className="results-activity" aria-label="What the venue scout is doing">
        {search.activity.length === 0 ? (
          <li className="is-running">Starting the venue scout</li>
        ) : (
          search.activity.map((a) => (
            <li key={a.id} className={`is-${a.status}`}>
              {a.label}
            </li>
          ))
        )}
      </ul>
      <div className="venue-list" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="venue-card venue-card--skeleton">
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

function Filters({
  candidates,
  headcount,
  filters,
  onChange,
  shown,
}: {
  candidates: VenueCandidate[];
  headcount: number | null;
  filters: VenueFilters;
  onChange: (next: VenueFilters) => void;
  shown: number;
}) {
  const count = (keep: (v: VenueCandidate) => boolean) => candidates.filter(keep).length;
  const bookings = [...new Set(candidates.map((v) => v.booking))];

  function toggleBooking(booking: VenueCandidate['booking']) {
    const next = new Set(filters.booking);
    if (next.has(booking)) next.delete(booking);
    else next.add(booking);
    onChange({ ...filters, booking: next });
  }

  const checks = [
    {
      key: 'fitsHeadcount' as const,
      label: headcount !== null ? `Fits ${headcount} people` : 'Fits the headcount',
      n: count((v) => fits(v, headcount) === true),
      hidden: headcount === null,
    },
    { key: 'priceListed' as const, label: 'Price listed', n: count((v) => v.price !== null) },
    {
      key: 'cateringIncluded' as const,
      label: 'Catering included',
      n: count((v) => v.cateringIncluded === 'yes'),
    },
  ];

  return (
    <aside className="results-filters" aria-label="Filter venues">
      <p className="results-count">
        <strong>{shown}</strong> of {candidates.length} venues
      </p>
      <fieldset>
        <legend>Show only</legend>
        {checks
          .filter((c) => !c.hidden)
          .map((c) => (
            <label key={c.key}>
              <input
                type="checkbox"
                checked={filters[c.key]}
                onChange={(e) => onChange({ ...filters, [c.key]: e.target.checked })}
              />
              <span>{c.label}</span>
              <small>{c.n}</small>
            </label>
          ))}
      </fieldset>
      {bookings.length > 1 && (
        <fieldset>
          <legend>Book by</legend>
          {bookings.map((b) => (
            <label key={b}>
              <input
                type="checkbox"
                checked={filters.booking.has(b)}
                onChange={() => toggleBooking(b)}
              />
              <span>{bookingLabels[b]}</span>
              <small>{count((v) => v.booking === b)}</small>
            </label>
          ))}
        </fieldset>
      )}
    </aside>
  );
}

function VenueCard({
  venue,
  headcount,
  chosen,
  onChoose,
}: {
  venue: VenueCandidate;
  headcount: number | null;
  chosen: boolean;
  onChoose: (() => void) | null;
}) {
  const fit = fits(venue, headcount);
  const links = safeLinks(venue.sourceUrls);
  const quotes = [
    venue.capacity && { label: 'Capacity', text: venue.capacity.quote },
    venue.price && { label: 'Price', text: venue.price.quote },
    venue.cateringQuote && { label: 'Catering', text: venue.cateringQuote },
  ].filter((q): q is { label: string; text: string } => !!q);

  return (
    <article className={`venue-card${chosen ? ' is-chosen' : ''}`}>
      <div className="venue-info">
        <h3>{venue.name}</h3>
        {venue.area && <p className="muted venue-area">{venue.area}</p>}
        <ul className="venue-facts">
          <li className={fit === true ? 'is-good' : fit === false ? 'is-warn' : 'is-unknown'}>
            {venue.capacity
              ? `Up to ${venue.capacity.value} people${fit === false ? ' (too small)' : ''}`
              : 'Capacity unknown'}
          </li>
          <li
            className={
              venue.cateringIncluded === 'yes'
                ? 'is-good'
                : venue.cateringIncluded === 'no'
                  ? ''
                  : 'is-unknown'
            }
          >
            {venue.cateringIncluded === 'yes'
              ? 'Catering included'
              : venue.cateringIncluded === 'no'
                ? 'No catering'
                : 'Catering unknown'}
          </li>
          <li className={venue.booking === 'unknown' ? 'is-unknown' : ''}>
            {venue.booking === 'unknown'
              ? 'Booking method unknown'
              : `Book by ${bookingLabels[venue.booking]}`}
          </li>
        </ul>
        {venue.notes && <p className="venue-notes">{venue.notes}</p>}
        {quotes.length > 0 && (
          <details className="venue-quotes">
            <summary>What the page says</summary>
            <dl>
              {quotes.map((q) => (
                <div key={q.label}>
                  <dt>{q.label}</dt>
                  <dd>“{q.text}”</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
      <div className="venue-price">
        {venue.price ? (
          <>
            <strong>{formatMoney(venue.price.amountMinor, venue.price.currency)}</strong>
            <span className="muted">{perLabel[venue.price.per]}</span>
          </>
        ) : (
          <>
            <strong className="venue-price--none">Price on request</strong>
            <span className="muted">No page listed a price</span>
          </>
        )}
        {venue.contact && <span className="venue-contact">{venue.contact}</span>}
        {chosen ? (
          <span className="venue-chosen" role="status">
            Chosen
          </span>
        ) : (
          onChoose && (
            <button type="button" className="venue-choose" onClick={onChoose}>
              Choose this venue
            </button>
          )
        )}
        {links[0] && (
          <a className="venue-cta" href={links[0].href} target="_blank" rel="noopener noreferrer">
            View source
          </a>
        )}
        {links[0] && <span className="venue-sources muted">{links[0].host}</span>}
        {links.length > 1 && (
          <span className="venue-sources muted">
            Also on{' '}
            {links.slice(1).map((l, i) => (
              <span key={l.href}>
                {i > 0 && ', '}
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.host}
                </a>
              </span>
            ))}
          </span>
        )}
      </div>
    </article>
  );
}
