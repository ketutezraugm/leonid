import { createApp } from './app.js';
import { registerLedgerHandlers } from './webhooks/handlers/index.js';

// Once per process (not in createApp, which tests call many times).
registerLedgerHandlers();

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
