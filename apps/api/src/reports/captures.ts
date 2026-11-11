import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { approvals, auditLog } from '../db/schema.js';

// A spend the treasurer approved is recorded under its PayPal ORDER id, but the payment that PayPal lists (in Transaction Search and in
// the payer's and merchant's activity) has the CAPTURE id, a different id. The executor writes the capture id on the spend.capture audit
// row when it captures the approval, so this maps order id -> capture id. The report shows and checks the capture id: it is the one
// that can be looked up in PayPal, and matching on it stays exact instead of guessing from amounts.
export async function captureIdsByOrder(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ orderId: approvals.paypalOrderId, captureId: auditLog.paypalId })
    .from(approvals)
    .innerJoin(
      auditLog,
      and(eq(auditLog.action, 'spend.capture'), eq(auditLog.outcome, 'paid'), sql`${auditLog.input}->>'referenceId' = ${approvals.spend}->>'referenceId'`),
    )
    .where(and(isNotNull(approvals.paypalOrderId), isNotNull(auditLog.paypalId)));
  const map = new Map<string, string>();
  for (const { orderId, captureId } of rows) if (orderId && captureId && captureId !== orderId) map.set(orderId, captureId);
  return map;
}
