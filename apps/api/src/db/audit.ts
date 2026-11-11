import type { Db } from './client.js';
import { auditLog } from './schema.js';

export interface AuditEntry {
  actor: string;
  action: string;
  input?: unknown;
  reason?: string | null;
  ruleResult?: string | null;
  paypalId?: string | null;
}

export async function writeAudit(db: Db, entry: AuditEntry) {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    input: entry.input ?? null,
    reason: entry.reason ?? null,
    ruleResult: entry.ruleResult ?? null,
    paypalId: entry.paypalId ?? null,
  });
}
