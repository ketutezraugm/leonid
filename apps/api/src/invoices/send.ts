import type { InvoiceDraft } from '@quartermaster/shared';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { sponsors } from '../db/schema.js';
import type { PayPalClient } from '../paypal/client.js';
import { createInvoice, getInvoice, sendInvoice } from '../paypal/invoicing.js';
import { loadSponsorWithEvent } from './draft.js';

export type InvoiceRefusal =
  | 'sponsor_not_found'
  | 'already_paid'
  | 'already_invoiced'
  | 'draft_mismatch'
  | 'stale_invoice';

// The request is understood but must not proceed. Nothing was sent to the sponsor.
export class InvoiceRefusedError extends Error {
  constructor(
    readonly code: InvoiceRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'InvoiceRefusedError';
  }
}

export interface InvoiceDeps {
  db: Db;
  client: PayPalClient;
  now?: () => Date;
}

export interface SendSponsorInvoiceInput {
  sponsorId: string;
  // The draft the treasurer confirmed. It is checked against the pledge, never trusted.
  draft: InvoiceDraft;
  recipientEmail: string;
  actor: string;
}

export interface SentInvoice {
  paypalInvoiceId: string;
  invoiceNumber: string | null;
  recipientViewUrl: string | null;
  // True when an earlier attempt had already created the PayPal invoice and this one finished it.
  resumed: boolean;
}

// An invoice in one of these PayPal states cannot be sent again, and not every one can be paid.
const DEAD = new Set(['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED']);

const DAY_MS = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Create the PayPal invoice for a sponsor's pledge, send it, and record it: paypal_invoice_id on the
// sponsor, status 'invoiced'. This is what lets the INVOICING.INVOICE.PAID handler credit the ledger.
//
// PayPal's invoice create has no idempotency key, so a retry would invoice the sponsor twice. Instead:
//  - an advisory lock serializes sends per sponsor (a double click waits, then is refused);
//  - the PayPal invoice id is saved the moment it exists, before sending, so a failed send is
//    finished by the next attempt rather than creating a second invoice;
//  - a sponsor that is already invoiced or paid is refused.
export async function sendSponsorInvoice(
  deps: InvoiceDeps,
  input: SendSponsorInvoiceInput,
): Promise<SentInvoice> {
  const { db, client } = deps;
  const today = (deps.now ?? (() => new Date()))();
  const recipientEmail = z.email().parse(input.recipientEmail);
  const { draft, actor } = input;

  let failure: unknown;
  let sent: SentInvoice | undefined;

  await db.transaction(async (tx) => {
    // Released when the transaction ends, even if the process dies.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sponsorId}))`);

    const found = await loadSponsorWithEvent(tx, input.sponsorId);
    if (!found) throw new InvoiceRefusedError('sponsor_not_found', 'No such sponsor');
    const { sponsor, event } = found;
    if (sponsor.status === 'paid') {
      throw new InvoiceRefusedError('already_paid', `${sponsor.name} has already paid`);
    }
    if (sponsor.status === 'invoiced') {
      throw new InvoiceRefusedError('already_invoiced', `${sponsor.name} has already been invoiced`);
    }
    const total = draft.items.reduce((sum, i) => sum + i.quantity * i.unitAmount, 0);
    if (draft.sponsorId !== sponsor.id || draft.currency !== event.currency || total !== sponsor.pledged) {
      throw new InvoiceRefusedError(
        'draft_mismatch',
        `The draft must invoice the full pledge of ${sponsor.pledged} ${event.currency} minor units to this sponsor`,
      );
    }

    const auditInput = {
      sponsorId: sponsor.id,
      total,
      currency: draft.currency,
      recipientEmail,
      dueInDays: draft.dueInDays,
    };
    let invoiceId = sponsor.paypalInvoiceId;
    try {
      const resumed = invoiceId !== null;
      if (invoiceId === null) {
        await writeAudit(tx, { actor, action: 'invoice.create', input: auditInput, reason: draft.reasoning });
        const created = await createInvoice(client, {
          currency: draft.currency,
          invoiceDate: isoDate(today),
          dueDate: draft.dueInDays === 0 ? null : isoDate(new Date(today.getTime() + draft.dueInDays * DAY_MS)),
          note: draft.note,
          invoicerName: event.name,
          recipientEmail,
          recipientName: sponsor.name,
          items: draft.items.map((i) => ({
            name: i.name,
            description: i.description,
            quantity: i.quantity,
            unitAmountMinor: i.unitAmount,
          })),
        });
        invoiceId = created.id;
        // Saved before sending: from here a failure leaves a record to resume from, not an orphan.
        await tx.update(sponsors).set({ paypalInvoiceId: invoiceId }).where(eq(sponsors.id, sponsor.id));
      }

      const existing = resumed ? await getInvoice(client, invoiceId) : undefined;
      if (existing && DEAD.has(existing.status)) {
        throw new InvoiceRefusedError(
          'stale_invoice',
          `PayPal invoice ${invoiceId} is ${existing.status}; clear it on the sponsor before invoicing again`,
        );
      }
      if (!existing || existing.status === 'DRAFT') {
        await sendInvoice(client, invoiceId, { subject: `Invoice from ${event.name}`, note: draft.note });
      }

      const view = await getInvoice(client, invoiceId);
      await tx.update(sponsors).set({ status: 'invoiced' }).where(eq(sponsors.id, sponsor.id));
      await writeAudit(tx, {
        actor,
        action: 'invoice.sent',
        input: { ...auditInput, invoiceNumber: view.invoiceNumber, resumed },
        reason: draft.reasoning,
        paypalId: invoiceId,
      });
      sent = {
        paypalInvoiceId: invoiceId,
        invoiceNumber: view.invoiceNumber,
        recipientViewUrl: view.recipientViewUrl,
        resumed,
      };
    } catch (err) {
      // Commit what was saved (the PayPal invoice id) and the trace, then rethrow once out of the transaction.
      failure = err;
      await writeAudit(tx, {
        actor,
        action: 'invoice.failed',
        input: auditInput,
        reason: `failed: ${err instanceof Error ? err.message : String(err)}`,
        paypalId: invoiceId,
      }).catch(() => undefined);
    }
  });

  if (failure) throw failure;
  if (!sent) throw new Error('invoice send finished without a result');
  return sent;
}
