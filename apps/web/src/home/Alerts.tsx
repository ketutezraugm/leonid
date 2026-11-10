import { Link } from 'react-router-dom';
import { DeliveryRiskResponse, SponsorsResponse } from '@leonid/shared';
import { useFetch } from '../shell/api';
import { useEvent, useEventPath, withEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { formatMoney } from '../ui/money';
import { StatusBadge } from '../ui/StatusBadge';

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

// What could go wrong, from two live feeds: purchases whose tracked delivery lands after their deadline
// (GET /api/widgets/delivery-risk) and sponsors invoiced but not yet paid (GET /api/sponsors). Each loads and
// fails on its own, so one missing feed never hides the other.
export function Alerts() {
  const event = useEvent();
  const path = useEventPath();
  const delivery = useFetch(withEvent('/api/widgets/delivery-risk', event), DeliveryRiskResponse);
  const sponsors = useFetch(withEvent('/api/sponsors', event), SponsorsResponse);

  const late =
    delivery.kind === 'ready'
      ? delivery.data.data.items.filter((i) => i.risk === 'late' || i.risk === 'at_risk')
      : [];
  const unpaid =
    sponsors.kind === 'ready' ? sponsors.data.sponsors.filter((s) => s.status === 'invoiced') : [];
  const loading = delivery.kind === 'loading' || sponsors.kind === 'loading';
  const failed = delivery.kind === 'error' || sponsors.kind === 'error';
  const quiet = !loading && late.length === 0 && unpaid.length === 0;

  return (
    <section className="card" aria-labelledby="alerts-title">
      <div className="section-head">
        <h2 id="alerts-title">Alerts</h2>
        {delivery.kind === 'ready' && delivery.data.source === 'sample' && (
          <span className="sample-tag">Sample deliveries</span>
        )}
      </div>
      {loading && (
        <p className="muted" role="status">
          Checking deliveries and invoices…
        </p>
      )}
      {failed && (
        <p className="muted">
          Couldn’t check {delivery.kind === 'error' ? 'deliveries' : 'invoices'}.{' '}
          <Button
            variant="secondary"
            onClick={() => {
              if (delivery.kind === 'error') delivery.reload();
              if (sponsors.kind === 'error') sponsors.reload();
            }}
          >
            Try again
          </Button>
        </p>
      )}
      {quiet && !failed && (
        <p className="muted">
          Nothing to worry about: deliveries are on time and every invoice is paid.
        </p>
      )}
      {(late.length > 0 || unpaid.length > 0) && (
        <ul className="alert-list">
          {late.map((item) => (
            <li key={item.orderId}>
              <StatusBadge
                status={item.risk === 'late' ? 'blocked' : 'risk'}
                label={item.risk === 'late' ? 'Late' : 'At risk'}
              />
              <p>
                {item.name}
                {item.expectedDelivery
                  ? ` arrives ${shortDate(item.expectedDelivery)}`
                  : ' has no delivery date yet'}
                , deadline {shortDate(item.deadline)}.
              </p>
              <Link to={path('plan')}>Open the plan</Link>
            </li>
          ))}
          {unpaid.map((sponsor) => (
            <li key={sponsor.id}>
              <StatusBadge status="pending" label="Not paid" />
              <p>
                {sponsor.name} has been invoiced {formatMoney(sponsor.pledged, sponsor.currency)}{' '}
                and has not paid yet.
              </p>
              <Link to={path('money')}>Open Money</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
