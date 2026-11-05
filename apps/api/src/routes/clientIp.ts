import { Router } from 'express';
import { requireTreasurer } from '../auth/treasurer.js';

// TEMPORARY probe (delete once the proxy question is answered): how does the proxy chain in front of this server look from
// the server's side? Treasurer-only, and it only echoes the caller's own address data, no secrets. The per-IP rate limits key on
// req.ip, so what matters is whether req.ip is the visitor or a proxy shared by everyone. Send a spoofed
// `X-Forwarded-For: 9.9.9.9` too, to see which entries the proxies append and which one `trust proxy` picks.
export function clientIpRouter(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();
  router.get('/', requireTreasurer(env), (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      trustProxy: req.app.get('trust proxy'),
      xForwardedFor: req.header('x-forwarded-for') ?? null,
      cfConnectingIp: req.header('cf-connecting-ip') ?? null,
      trueClientIp: req.header('true-client-ip') ?? null,
    });
  });
  return router;
}
