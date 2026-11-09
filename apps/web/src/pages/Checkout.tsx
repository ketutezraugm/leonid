import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PayButtons } from '../checkout/PayButtons';
import { parseDollars } from '../checkout/api';
import { CheckoutConfig } from '@leonid/shared';
import { ApiFailure, useFetch } from '../shell/api';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { formatMoney } from '../ui/money';
import { PageHeader } from '../ui/PageHeader';
import { PageState } from '../ui/PageState';

// Public, no login (/e/:eventId): anyone can buy a ticket or give a donation. The money lands in the event's Treasury
// account and raises its unlocked budget once PayPal confirms it (webhook), which can take a moment after paying.
export function Checkout() {
  const { eventId = '' } = useParams();
  const config = useFetch(`/api/checkout/${encodeURIComponent(eventId)}/config`, CheckoutConfig);
  const [donation, setDonation] = useState('25');
  const [thanks, setThanks] = useState<string | null>(null);

  if (config.kind === 'loading') return <PageState kind="loading" title="Loading the event…" />;
  if (config.kind === 'error') {
    return config.error instanceof ApiFailure && config.error.status === 404 ? (
      <PageState kind="empty" title="We couldn't find this event">
        Check the link you were given.
      </PageState>
    ) : (
      <PageState kind="error" title="Checkout isn't available right now" onRetry={config.reload}>
        Nothing was charged.
      </PageState>
    );
  }

  const c = config.data;
  const donationMinor = parseDollars(donation);
  const donationOk = donationMinor !== null && donationMinor >= c.donationMinMinor && donationMinor <= c.donationMaxMinor;
  if (thanks) {
    return (
      <PageState kind="empty" title="Thank you!">
        {thanks}
      </PageState>
    );
  }
  const done = (what: string) => (status: 'paid' | 'pending') =>
    setThanks(
      status === 'paid'
        ? `Your ${what} to ${c.eventName} went through. PayPal will email you a receipt.`
        : `Your ${what} to ${c.eventName} is with PayPal for review. PayPal will email you when it clears.`,
    );

  return (
    <section>
      <PageHeader title={c.eventName} description="Pay securely with PayPal. No account here is needed." />
      {c.ticketPriceMinor !== null && (
        <Card title={`Ticket · ${formatMoney(c.ticketPriceMinor, c.currency)}`}>
          <PayButtons eventId={eventId} config={c} request={{ kind: 'ticket' }} onPaid={done('ticket')} />
        </Card>
      )}
      <Card title="Donate">
        <Field
          id="donation"
          label={`Amount (${c.currency})`}
          inputMode="decimal"
          value={donation}
          onChange={(e) => setDonation(e.target.value)}
          error={donationOk ? undefined : `Enter an amount from ${formatMoney(c.donationMinMinor, c.currency)} to ${formatMoney(c.donationMaxMinor, c.currency)}.`}
        />
        {donationOk && <PayButtons eventId={eventId} config={c} request={{ kind: 'donation', amountMinor: donationMinor }} onPaid={done('donation')} />}
      </Card>
    </section>
  );
}
