import { useEffect, useRef, useState } from 'react';
import type { CheckoutConfig, CreateCheckoutOrderRequest } from '@leonid/shared';
import { loadTreasurySdk } from '../lib/paypalSdk';
import { captureCheckoutOrder, createCheckoutOrder } from './api';

// PayPal's own button for one ticket or donation. The browser only shows the popup: the server creates the order (and
// sets its price), and captures it once PayPal says the buyer approved. onPaid runs after the capture succeeded.
export function PayButtons({
  eventId,
  config,
  request,
  onPaid,
}: {
  eventId: string;
  config: CheckoutConfig;
  request: CreateCheckoutOrderRequest;
  onPaid: (status: 'paid' | 'pending') => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const key = JSON.stringify(request);

  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    let buttons: { close: () => Promise<void> } | null = null;
    let cancelled = false;
    let orderId = '';
    setFailure(null);
    loadTreasurySdk(config.clientId, config.currency)
      .then(async (paypal) => {
        if (cancelled) return;
        container.replaceChildren();
        const instance = paypal.Buttons({
          style: { layout: 'vertical', tagline: false, height: 40 },
          createOrder: async () => {
            orderId = (await createCheckoutOrder(eventId, request)).orderId;
            return orderId;
          },
          onApprove: async () => {
            try {
              onPaid((await captureCheckoutOrder(eventId, orderId)).status);
            } catch {
              setFailure("PayPal couldn't take the payment. Check your PayPal activity before trying again.");
            }
          },
          onCancel: () => setFailure('The PayPal window was closed. Nothing was charged.'),
          onError: () => setFailure("PayPal couldn't start the payment. Nothing was charged; try again."),
        });
        buttons = instance;
        await instance.render(container);
      })
      .catch(() => !cancelled && setFailure("PayPal's buttons didn't load. Check your connection, then try again."));
    return () => {
      cancelled = true;
      void buttons?.close().catch(() => undefined);
    };
    // Rebuilt only when what is being bought changes (a different donation amount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, config.clientId, config.currency, key]);

  return (
    <>
      <div ref={mount} />
      {failure && (
        <p role="alert" className="field-error">
          {failure}
        </p>
      )}
    </>
  );
}
