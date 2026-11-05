# P2 research notes (verified Oct 27, 2026)

Local only. "Unverified" means I could not confirm it from a primary source; re-check before relying on it.

## Hackathon
- Submissions close Nov 12, 2026 12:00 PM PST; winners Dec 21 ([PayPal blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/)). Judging dates are not published; the hosted demo must stay up until Dec 21.
- Requirement: meaningfully use both PayPal and AI.

## PayPal
- Server SDK `@paypal/paypal-server-sdk` 2.5.0: Orders, Payments, Vault (US only), Transaction Search, Subscriptions. No Invoicing, Payouts, Identity or webhooks ([GitHub](https://github.com/paypal/PayPal-TypeScript-Server-SDK)).
- `@paypal/agent-toolkit` 1.11.0 depends on `ai@^4` and `zod@^3`, has `pay_order` and `create_refund`, no Payouts or Vault ([npm](https://registry.npmjs.org/@paypal/agent-toolkit/latest), [GitHub](https://github.com/paypal/agent-toolkit)). Not given to agents.
- Vault without purchase: setup token, payer approval, payment token, then Orders with `vault_id` ([PayPal docs](https://developer.paypal.com/api/payment-tokens/save-without-purchase/paypal)). Setup tokens expire after 3 days. Unverified: business account as payer; whether deletion is immediate.
- Webhook verification: postback needs the exact raw body; simulator events use webhook id `WEBHOOK_ID` and cannot use postback; retries up to 25 times over 3 days ([docs](https://developer.paypal.com/api/rest/webhooks/rest/)).
- All 10 PRD webhook event names exist ([event list](https://developer.paypal.com/api/rest/webhooks/event-names/)). `INVOICING.INVOICE.PAID` also fires for partial or pending payments. `VAULT.PAYMENT-TOKEN.DELETION-INITIATED` exists.
- Log in with PayPal: public HTTPS return URL, exact match; localhost is reported not to work ([integration steps](https://developer.paypal.com/docs/log-in-with-paypal/integrate/)). Scope uses `uri.paypal.com`. The `paypalv1.1` schema and `oauth2/userinfo` path appear only in a third-party mirror: unverified, test both userinfo paths.
- `GET /v1/reporting/balances`: scope `reporting/balances/read`, lags up to 3 hours ([docs](https://developer.paypal.com/api/transaction-search/v1/balances-get)).
- Payouts to Venmo: `recipient_wallet: VENMO` plus a US mobile number; no documented sandbox test numbers.
- Browser SDK: `@paypal/react-paypal-js` 10.6.1; `/sdk-v6` exports `PayPalProvider` and `PayPalOneTimePaymentButton` ([npm](https://unpkg.com/@paypal/react-paypal-js@10.6.1/README.md)).

## APIMatic
- Install: `npx context-plugins install paypal`, then `/reload-plugins` ([installer](https://github.com/apimatic/context-plugins-installer)). Participants: 1 month Basic; winning teams: 6 months Business (claim form on the sponsor page).

## Render
- Workflows TypeScript SDK `@renderinc/sdk` 1.5.0; `task` from `@renderinc/sdk/workflows`; trigger with `new Render().workflows.startTask(slug, args, { idempotencyKey })`; local: `render workflows dev -- <cmd>` ([SDK README](https://raw.githubusercontent.com/render-oss/sdk/main/typescript/README.md)).
- Flex compute $0.20/CPU-hour + $0.05/GB-hour; no native cron, so a cron service triggers runs ([limits](https://render.com/docs/workflows-limits)).
- Web ~$7/mo (0.5c-512mb), Postgres ~$6/mo (0.1c-256mb) plus storage $0.30/GB (third-party pricing summaries; check render.com/pricing). Free web sleeps after 15 min; free Postgres expires after 30 days ([free tier](https://render.com/docs/free)).
- Sponsor perk: $50 credits, already redeemed. Expiry unknown: read it in Billing.
- Unverified: whether the old `starter` / `basic-256mb` plan names in `render.yaml` still work.
- Render CLI v2.32.0 installed to `~/.local/bin/render.exe`.

## Models and cost (owned by Harfi; for reference)
- Claude pricing per 1M tokens ([claude.com/pricing](https://claude.com/pricing)): Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20.
- Gemini Flash-Lite has a free tier; free-tier data may be used to improve products ([Google](https://ai.google.dev/gemini-api/docs/pricing)).
- Vercel AI SDK: `ai` 7.0.154; structured output is `generateText` with `Output.object`; test with `MockLanguageModelV4` from `ai/test` ([docs](https://ai-sdk.dev/docs/ai-sdk-core/testing)).

## Other sponsors (not P2)
- Channel3: 20,000 credits with `PAYPAL-HACKATHON-2026`; `POST https://api.trychannel3.com/v1/search`, header `x-api-key`; SDK `@channel3/sdk` 4.5.0.
- AG Studio and Bryntum: 45-day trials, expiring about Dec 11, before winners are announced. Ask the sponsors about extensions.

## Database
- Drizzle ORM 0.45.4, drizzle-kit 0.31.11, `pg` driver; Render Postgres default is v18, so Docker uses `postgres:18`.
