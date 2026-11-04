import { CheckoutCaptureResponse, CheckoutOrderResponse, type CreateCheckoutOrderRequest } from '@quartermaster/shared';
import { sendJson } from '../shell/api';

// The public checkout endpoints (packages/shared/src/checkout.ts); the config is read in pages/Checkout.tsx. No login; the server sets every price.
export const createCheckoutOrder = (eventId: string, request: CreateCheckoutOrderRequest) =>
  sendJson(`/api/checkout/${encodeURIComponent(eventId)}/orders`, CheckoutOrderResponse, request);

export const captureCheckoutOrder = (eventId: string, orderId: string) =>
  sendJson(`/api/checkout/${encodeURIComponent(eventId)}/orders/${encodeURIComponent(orderId)}/capture`, CheckoutCaptureResponse);

// "12.50" -> 1250. Whole cents only, no floats; anything else is null.
export function parseDollars(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null;
}
