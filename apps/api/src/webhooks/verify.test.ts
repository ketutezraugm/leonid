import { createSign, generateKeyPairSync } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CERT_FETCH_TIMEOUT_MS, loadPayPalKey, verifyWebhook, type WebhookHeaders } from './verify.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const loadKey = async () => publicKey;
const rawBody = Buffer.from('{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED"}');

function sign(webhookId: string, body = rawBody) {
  const message = `T-1|2026-10-27T10:00:00Z|${webhookId}|${crc32(body)}`;
  return createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}
function headers(sig: string): WebhookHeaders {
  return {
    transmissionId: 'T-1',
    transmissionTime: '2026-10-27T10:00:00Z',
    transmissionSig: sig,
    certUrl: 'https://api.sandbox.paypal.com/cert.pem',
    authAlgo: 'SHA256withRSA',
  };
}

describe('verifyWebhook', () => {
  it('accepts a correctly signed event', async () => {
    expect(await verifyWebhook({ headers: headers(sign('MY-ID')), rawBody, webhookIds: ['MY-ID'], loadKey })).toBe(true);
  });
  it('accepts the simulator id when it is in the allowed list', async () => {
    const h = headers(sign('WEBHOOK_ID'));
    expect(await verifyWebhook({ headers: h, rawBody, webhookIds: ['MY-ID', 'WEBHOOK_ID'], loadKey })).toBe(true);
    expect(await verifyWebhook({ headers: h, rawBody, webhookIds: ['MY-ID'], loadKey })).toBe(false);
  });
  it('rejects a body that was changed after signing', async () => {
    const tampered = Buffer.from('{"id":"WH-1","event_type":"PAYMENT.CAPTURE.REFUNDED"}');
    expect(await verifyWebhook({ headers: headers(sign('MY-ID')), rawBody: tampered, webhookIds: ['MY-ID'], loadKey })).toBe(false);
  });
  it('rejects an unsupported algorithm', async () => {
    const h = { ...headers(sign('MY-ID')), authAlgo: 'SHA1withRSA' };
    expect(await verifyWebhook({ headers: h, rawBody, webhookIds: ['MY-ID'], loadKey })).toBe(false);
  });
});

describe('loadPayPalKey', () => {
  it('refuses certificate urls outside paypal.com or without https', async () => {
    await expect(loadPayPalKey('https://evil.example.com/cert.pem')).rejects.toThrow('untrusted');
    await expect(loadPayPalKey('https://paypal.com.evil.io/cert.pem')).rejects.toThrow('untrusted');
    await expect(loadPayPalKey('http://api.paypal.com/cert.pem')).rejects.toThrow('untrusted');
  });

  describe('when the certificate host hangs', () => {
    afterEach(() => vi.restoreAllMocks());

    it('gives up after the timeout instead of holding the webhook request open', async () => {
      // A fetch that never answers and only ends when its signal aborts (at once if it is already aborted), as a hung server would behave.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              const signal = init?.signal;
              if (signal?.aborted) reject(signal.reason);
              else signal?.addEventListener('abort', () => reject(signal.reason));
            }),
        ),
      );
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new Error('timed out')));
      await expect(loadPayPalKey('https://api.paypal.com/hung-cert.pem')).rejects.toThrow('timed out');
      expect(timeout).toHaveBeenCalledWith(CERT_FETCH_TIMEOUT_MS);
      vi.unstubAllGlobals();
    });
  });
});
