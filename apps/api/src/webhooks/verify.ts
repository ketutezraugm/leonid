import { createVerify, X509Certificate, type KeyObject } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { crc32 } from 'node:zlib';

// PayPal's webhook simulator signs with this literal id instead of our real webhook id.
export const SIMULATOR_WEBHOOK_ID = 'WEBHOOK_ID';

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

export function readWebhookHeaders(h: IncomingHttpHeaders): WebhookHeaders | undefined {
  const get = (name: string) => {
    const v = h[name];
    return typeof v === 'string' && v ? v : undefined;
  };
  const transmissionId = get('paypal-transmission-id');
  const transmissionTime = get('paypal-transmission-time');
  const transmissionSig = get('paypal-transmission-sig');
  const certUrl = get('paypal-cert-url');
  const authAlgo = get('paypal-auth-algo');
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) return undefined;
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

export type KeyLoader = (certUrl: string) => Promise<KeyObject>;

const keyCache = new Map<string, KeyObject>();

// Only fetch certificates from paypal.com over https, otherwise an attacker could point us at their own key.
// ponytail: no X.509 chain validation; the cert host pin is the trust anchor. Add chain checks if the threat model needs it.
export const loadPayPalKey: KeyLoader = async (certUrl) => {
  const url = new URL(certUrl);
  const trusted = url.protocol === 'https:' && (url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com'));
  if (!trusted) throw new Error(`untrusted PayPal cert url: ${url.hostname}`);
  const cached = keyCache.get(certUrl);
  if (cached) return cached;
  const res = await fetch(certUrl);
  if (!res.ok) throw new Error(`could not fetch PayPal cert: HTTP ${res.status}`);
  const key = new X509Certificate(await res.text()).publicKey;
  keyCache.set(certUrl, key);
  return key;
};

// Self-verification (no PayPal API call): the signature covers
// "transmissionId|transmissionTime|webhookId|crc32(rawBody)". rawBody must be the exact bytes received.
export async function verifyWebhook(args: {
  headers: WebhookHeaders;
  rawBody: Buffer;
  webhookIds: string[];
  loadKey?: KeyLoader;
}): Promise<boolean> {
  const { headers, rawBody, webhookIds, loadKey = loadPayPalKey } = args;
  if (headers.authAlgo !== 'SHA256withRSA') return false;
  const key = await loadKey(headers.certUrl);
  const crc = crc32(rawBody);
  return webhookIds.some((id) => {
    const message = `${headers.transmissionId}|${headers.transmissionTime}|${id}|${crc}`;
    return createVerify('RSA-SHA256').update(message).verify(key, headers.transmissionSig, 'base64');
  });
}
