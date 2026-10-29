import { createApp } from './app.js';
import { assertDurableMoneyState } from './payments/context.js';

assertDurableMoneyState(); // fail the deploy rather than run production on in-memory money state

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
