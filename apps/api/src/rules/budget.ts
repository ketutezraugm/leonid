// The funds-gated budget (F10): unlocked = cleared income - committed spend. Pure, so the arithmetic can be tested
// without a database. db/budget.ts loads the records this reads.

// One line of what the executor recorded about a spend: a spend.check audit row, with its approval laid over it.
export interface SpendRecord {
  referenceId: string;
  amountMinor: number;
  category: string | null;
  decision: 'allow' | 'needs_approval' | 'block' | null; // null: the rule result could not be read
  outcome: string | null; // null: still in flight, or the server stopped mid-call
  approval: 'pending' | 'capturing' | 'rejected' | 'paid' | null;
}

export interface CommittedSpend {
  referenceId: string;
  amountMinor: number;
  category: string | null;
  autoPaid: boolean; // moved with no human: true for the agent wallet, false once the treasurer holds it
}

// Outcomes that mean no money moved and none will. Anything else holds the money, so an outcome this list has not heard
// of fails closed. 'error' stays held on purpose: a dropped connection may have charged the wallet.
const RELEASED_OUTCOMES = new Set(['blocked', 'refused', 'failed']);

const holdsMoney = (r: SpendRecord) => r.decision !== 'block' && !RELEASED_OUTCOMES.has(r.outcome ?? '');

// What is committed, one entry per spend: a retry writes a second audit row for the same referenceId and must not count
// twice. A spend sent to the treasurer holds its money from the moment it is asked, not from the capture, so two carts
// racing for the same dollars cannot both pass. Rejecting it gives the money back.
export function committedSpends(records: readonly SpendRecord[]): CommittedSpend[] {
  const byReference = new Map<string, SpendRecord[]>();
  for (const record of records) {
    byReference.set(record.referenceId, [...(byReference.get(record.referenceId) ?? []), record]);
  }
  return [...byReference.values()].flatMap((rows) => {
    const held = rows.find(holdsMoney);
    if (!held || rows.some((r) => r.approval === 'rejected')) return [];
    const { referenceId, amountMinor, category } = held;
    const autoPaid = rows.every((r) => r.approval === null) && held.decision === 'allow';
    return [{ referenceId, amountMinor, category, autoPaid }];
  });
}

export const sumMinor = (spends: readonly { amountMinor: number }[]) =>
  spends.reduce((total, spend) => total + spend.amountMinor, 0);

// Can be negative: a refunded or charged-back sponsor payment leaves commitments the income no longer covers.
export const unlockedBudget = (clearedMinor: number, committedMinor: number) =>
  clearedMinor - committedMinor;
