import { PayoutsLedgerData, type WidgetFilter } from '@leonid/shared';
import type { Db } from '../db/client.js';
import { getEvent } from '../db/events.js';
import { listPayoutItems } from '../payouts/service.js';

// The payouts ledger (F17), live: every claim, prize and speaker fee of the event with what PayPal last said
// about it. Read-only. Undefined when the event does not exist.
export async function getPayoutsLedger(
  db: Db,
  eventId: string,
  filter: WidgetFilter = {},
  now: Date = new Date(),
): Promise<PayoutsLedgerData | undefined> {
  if (!(await getEvent(db, eventId))) return undefined;
  return PayoutsLedgerData.parse({ asOf: now.toISOString(), rows: await listPayoutItems({ db }, eventId, filter) });
}
