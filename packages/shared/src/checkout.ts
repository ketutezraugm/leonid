import { z } from 'zod';
import { CurrencyCode, MinorUnits } from './common.js';

// Public checkout for an event's tickets and donations (F6). No login: anyone with the event page can pay.
//   GET  /api/checkout/:eventId/config                       CheckoutConfig
//   POST /api/checkout/:eventId/orders                       CreateCheckoutOrderRequest -> CheckoutOrderResponse
//   POST /api/checkout/:eventId/orders/:orderId/capture      after PayPal's button approved it -> CheckoutCaptureResponse
// The price of a ticket always comes from the server. The browser only shows PayPal's button (the client id here is public
// by design); the server creates and captures the order, and the ledger is credited by PayPal's webhook, not by capture.

export const DONATION_MIN_MINOR = 100;
export const DONATION_MAX_MINOR = 50_000;

export const CheckoutConfig = z.object({
  eventName: z.string(),
  currency: CurrencyCode,
  clientId: z.string(), // the Treasury PayPal app's public client id
  ticketPriceMinor: MinorUnits.nullable(), // null: this event sells no tickets
  donationMinMinor: MinorUnits,
  donationMaxMinor: MinorUnits,
});
export type CheckoutConfig = z.infer<typeof CheckoutConfig>;

export const CreateCheckoutOrderRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ticket') }),
  z.object({ kind: z.literal('donation'), amountMinor: z.number().int().min(DONATION_MIN_MINOR).max(DONATION_MAX_MINOR) }),
]);
export type CreateCheckoutOrderRequest = z.infer<typeof CreateCheckoutOrderRequest>;

export const CheckoutOrderResponse = z.object({ orderId: z.string() });
export type CheckoutOrderResponse = z.infer<typeof CheckoutOrderResponse>;

// 'paid': PayPal took the money. 'pending': PayPal is still reviewing the payment. Either way the budget grows when
// PayPal's webhook confirms the capture, not at this call.
export const CheckoutCaptureResponse = z.object({ status: z.enum(['paid', 'pending']) });
export type CheckoutCaptureResponse = z.infer<typeof CheckoutCaptureResponse>;
