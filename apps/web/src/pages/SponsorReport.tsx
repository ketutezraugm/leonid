import { SponsorReportView } from '@leonid/shared';
import { useParams } from 'react-router-dom';
import { ApiFailure, useFetch } from '../shell/api';
import { Card } from '../ui/Card';
import { CopyId } from '../ui/CopyId';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';
import { StatRow, StatTile } from '../ui/StatTile';

// Transaction Search can take hours to list a payment, so "not found" is worded as not yet, never as a problem with the purchase.
const CHECK_LABEL = { confirmed: 'Confirmed by PayPal', differs: "PayPal's record differs", not_found: "Not in PayPal's records yet" } as const;

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Public and shared outside the team, at an unguessable link (/report/:shareToken), no login. It names categories and vendors,
// never volunteers: the API leaves people out of it. Every figure is computed by the server; the summary may be written by a model
// from those same figures, and says so.
export function SponsorReport() {
  const { shareToken = '' } = useParams();
  const report = useFetch(`/api/reports/${encodeURIComponent(shareToken)}`, SponsorReportView);

  if (report.kind === 'loading') return <PageState kind="loading" title="Loading the report…" />;
  if (report.kind === 'error') {
    return report.error instanceof ApiFailure && report.error.status === 404 ? (
      <PageState kind="empty" title="We couldn't find this report">
        Check the link you were given, or ask the organizer to send it again.
      </PageState>
    ) : (
      <PageState kind="error" title="This report isn't available right now" onRetry={report.reload}>
        Try again in a moment.
      </PageState>
    );
  }

  const r = report.data;
  const money = (minor: number) => formatMoney(minor, r.currency);
  const checked = r.spend.lines.filter((l) => l.paypalCheck);
  const confirmed = checked.filter((l) => l.paypalCheck === 'confirmed').length;
  return (
    <section>
      <PageHeader title={`${r.sponsor.name}: sponsor report`} description={`Where your ${r.sponsor.tier} sponsorship of ${r.event.name} went.`} />
      <Card title="Summary">
        <p>{r.narrative.text}</p>
        {r.narrative.source === 'ai' && <p className="muted">Written by an AI assistant from the figures on this page.</p>}
      </Card>
      <StatRow>
        <StatTile label="Pledged" value={money(r.funds.pledgedMinor)} />
        <StatTile label="Received" value={money(r.funds.clearedMinor)} meta="After PayPal fees and refunds" />
        <StatTile label="Spent from it" value={money(r.spend.totalMinor)} meta={`${r.spend.lines.length} ${r.spend.lines.length === 1 ? 'purchase' : 'purchases'}`} />
      </StatRow>
      {r.spend.byCategory.length > 0 && (
        <Card title="By category">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Items</th>
                  <th className="num">Your share</th>
                </tr>
              </thead>
              <tbody>
                {r.spend.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td className="num">{c.purchases}</td>
                    <td className="num">{money(c.attributedMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card title="Purchases">
        {r.spend.lines.length === 0 ? (
          <p className="muted">Nothing has been spent from your sponsorship yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th className="num">Purchase</th>
                  <th className="num">Your share</th>
                  <th>PayPal ID</th>
                </tr>
              </thead>
              <tbody>
                {r.spend.lines.map((l, i) => (
                  <tr key={`${l.paypalId ?? 'none'}-${i}`}>
                    <td className="num">{day(l.at)}</td>
                    <td>{[l.vendor, l.category].filter(Boolean).join(' · ') || 'Purchase'}</td>
                    <td className="num">{money(l.purchaseMinor)}</td>
                    <td className="num">
                      {money(l.attributedMinor)} <span className="muted">{l.basis === 'direct' ? 'funded by you' : 'shared'}</span>
                    </td>
                    <td>
                      {l.paypalId ? <CopyId value={l.paypalId} /> : <span className="muted">None</span>}
                      {l.paypalCheck && <div className="muted">{CHECK_LABEL[l.paypalCheck]}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r.spend.paypalCheckedAt && checked.length > 0 && (
          <p className="muted">
            {confirmed} of {checked.length} {checked.length === 1 ? 'purchase' : 'purchases'} confirmed in PayPal&apos;s transaction records on{' '}
            {day(r.spend.paypalCheckedAt)}. PayPal can take a few hours to list a payment.
          </p>
        )}
      </Card>
      <Card title="How your share is worked out">
        <p>
          A purchase funded by one sponsor alone is counted in full for that sponsor. Every other purchase is paid from the event&apos;s
          pooled income, and each source pays its proportional share: each sponsor by what it paid in, and everyone else (ticket sales and
          donations) by the rest. Payments to people are included in the category totals only, never by name.
        </p>
        <p className="muted">Prepared by Leonid from PayPal records on {day(r.generatedAt)}. PayPal sandbox, no real money.</p>
      </Card>
    </section>
  );
}
