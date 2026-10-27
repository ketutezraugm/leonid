import { createSign, generateKeyPairSync } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadPayPalKey, verifyWebhook, type WebhookHeaders } from './verify.js';

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
});
