import type { InvoiceDraft } from '@quartermaster/shared';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { auditLog, sponsors } from '../db/schema.js';
import type { PayPalClient } from '../paypal/client.js';
import {
  createInvoice,
  getInvoice,
  searchInvoicesByReference,
  sendInvoice,
  type InvoiceView,
} from '../paypal/invoicing.js';
import { loadSponsorWithEvent } from './draft.js';

export type InvoiceRefusal =
  | 'sponsor_not_found'
  | 'already_paid'
  | 'already_invoiced'
  | 'draft_mismatch'
  | 'stale_invoice'
  | 'invoice_mismatch'
  | 'duplicate_invoice'
  | 'in_progress';

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

// How long an unfinished create attempt blocks others. After this it is presumed dead (crashed or timed
// out), and the next attempt looks the invoice up at PayPal by reference before creating one.
export const CREATE_LEASE_SECONDS = 300;

const DAY_MS = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Loaded = NonNullable<Awaited<ReturnType<typeof loadSponsorWithEvent>>>;

// Serializes invoice work per sponsor. Released when the transaction ends, even if the process dies.
const lockSponsor = (tx: Tx, sponsorId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sponsorId}))`);

// Moves a sponsor to 'invoiced' only from 'pledged', so it can never overwrite 'paid' (set by the
// INVOICING.INVOICE.PAID handler, which may land at any time). Returns whether the row changed.
export async function markSponsorInvoiced(db: Db | Tx, sponsorId: string): Promise<boolean> {
  const updated = await db
    .update(sponsors)
    .set({ status: 'invoiced' })
    .where(and(eq(sponsors.id, sponsorId), eq(sponsors.status, 'pledged')))
    .returning({ id: sponsors.id });
  return updated.length > 0;
}

// An invoice found at PayPal must be the one we would create now: this sponsor's full pledge, in the
// event currency. Invoices made before we set a reference have none, which is accepted.
function assertMatchesPledge(view: InvoiceView, sponsor: Loaded['sponsor'], currency: string) {
  const total = view.total;
  if (view.reference !== null && view.reference !== sponsor.id) {
    throw new InvoiceRefusedError(
      'invoice_mismatch',
      `PayPal invoice ${view.id} belongs to another sponsor; clear it on ${sponsor.name} before invoicing again`,
    );
  }
  if (!total || total.amountMinor !== sponsor.pledged || total.currency !== currency) {
    const found = total ? `${total.amountMinor} ${total.currency}` : 'no total';
    throw new InvoiceRefusedError(
      'invoice_mismatch',
      `PayPal invoice ${view.id} is for ${found} minor units, but ${sponsor.name}'s pledge is ${sponsor.pledged} ${currency}; cancel it at PayPal and clear it on the sponsor before invoicing again`,
    );
  }
}

// The latest create attempt for this sponsor, if it never recorded a PayPal id.
async function unfinishedCreate(tx: Tx, sponsorId: string) {
  const [latest] = await tx
    .select({
      id: auditLog.id,
      paypalId: auditLog.paypalId,
      createdAt: auditLog.createdAt,
      fresh: sql<boolean>`${auditLog.createdAt} > now() - make_interval(secs => ${CREATE_LEASE_SECONDS})`,
    })
    .from(auditLog)
    .where(and(eq(auditLog.action, 'invoice.create'), sql`${auditLog.input}->>'sponsorId' = ${sponsorId}`))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  if (!latest || latest.paypalId !== null) return undefined;
  // The attempt is over if it recorded its failure; otherwise it is running, or died without a trace.
  const [ended] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, 'invoice.failed'),
        sql`${auditLog.input}->>'sponsorId' = ${sponsorId}`,
        gte(auditLog.createdAt, latest.createdAt),
      ),
    )
    .limit(1);
  return { ...latest, running: Boolean(latest.fresh) && !ended };
}

// Create the PayPal invoice for a sponsor's pledge, send it, and record it: paypal_invoice_id on the
// sponsor, status 'invoiced'. This is what lets the INVOICING.INVOICE.PAID handler credit the ledger.
//
// PayPal's invoice create has no idempotency key, so a retry could invoice the sponsor twice. Instead:
//  1. Under a per-sponsor advisory lock, the invoice.create audit row is committed before PayPal is
//     called. It doubles as a lease: while it is fresh and unfinished, other attempts are refused.
//  2. The invoice carries the sponsor id as detail.reference. If an earlier attempt left an unfinished
//     create (a crash or timeout after PayPal may have made the invoice), the invoice is looked up by
//     that reference before a new one is created.
//  3. The PayPal id is committed on the sponsor and the audit row the moment it exists, before sending,
//     so a failed send is finished by the next attempt rather than duplicated.
//  4. An invoiced or paid sponsor is refused, and an invoice found at PayPal must match the pledge.
export async function sendSponsorInvoice(
  deps: InvoiceDeps,
  input: SendSponsorInvoiceInput,
): Promise<SentInvoice> {
  const { db, client } = deps;
  const today = (deps.now ?? (() => new Date()))();
  const recipientEmail = z.email().parse(input.recipientEmail);
  const { draft, actor } = input;

  let auditInput: Record<string, unknown> = { sponsorId: input.sponsorId };
  let invoiceId: string | null = null;
  const recordFailure = (err: unknown) =>
    writeAudit(db, {
      actor,
      action: 'invoice.failed',
      input: auditInput,
      reason: `failed: ${err instanceof Error ? err.message : String(err)}`,
      paypalId: invoiceId,
    }).catch(() => undefined);

  // Step 1: validate, then either resume a known invoice, recover a lost one, or commit the intent to create.
  type Start = Loaded & { resumed: boolean; markerId: string | null };
  let start: Start;
  let began = false;
  try {
    start = await db.transaction(async (tx): Promise<Start> => {
      await lockSponsor(tx, input.sponsorId);
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
      auditInput = { sponsorId: sponsor.id, total, currency: draft.currency, recipientEmail, dueInDays: draft.dueInDays };

      if (sponsor.paypalInvoiceId !== null) {
        invoiceId = sponsor.paypalInvoiceId;
        return { ...found, resumed: true, markerId: null };
      }

      const unfinished = await unfinishedCreate(tx, sponsor.id);
      if (unfinished?.running) {
        // Not audited as invoice.failed: that row would mark the other attempt as ended.
        throw new InvoiceRefusedError(
          'in_progress',
          `An invoice for ${sponsor.name} is already being created; try again in a few minutes`,
        );
      }
      began = true;
      if (unfinished) {
        // An earlier attempt may have created the invoice and lost the answer: find it before making another.
        const live = (await searchInvoicesByReference(client, sponsor.id)).filter((i) => !DEAD.has(i.status));
        if (live.length > 1) {
          throw new InvoiceRefusedError(
            'duplicate_invoice',
            `PayPal has ${live.length} open invoices for ${sponsor.name} (${live.map((i) => i.id).join(', ')}); cancel the extras at PayPal first`,
          );
        }
        const [recovered] = live;
        if (recovered) {
          assertMatchesPledge(recovered, sponsor, event.currency);
          invoiceId = recovered.id;
          await tx.update(sponsors).set({ paypalInvoiceId: recovered.id }).where(eq(sponsors.id, sponsor.id));
          await tx.update(auditLog).set({ paypalId: recovered.id }).where(eq(auditLog.id, unfinished.id));
          await writeAudit(tx, {
            actor,
            action: 'invoice.recovered',
            input: { ...auditInput, status: recovered.status },
            reason: 'An earlier create did not record its PayPal invoice; found it by reference instead of creating another',
            paypalId: recovered.id,
          });
          return { ...found, resumed: true, markerId: null };
        }
      }

      // Committed before PayPal is called, so a crash after the create still leaves a trace and a lease.
      const [marker] = await tx
        .insert(auditLog)
        .values({ actor, action: 'invoice.create', input: auditInput, reason: draft.reasoning })
        .returning({ id: auditLog.id });
      if (!marker) throw new Error('could not record the invoice.create audit row');
      return { ...found, resumed: false, markerId: marker.id };
    });
  } catch (err) {
    if (began) await recordFailure(err);
    throw err;
  }
  const { sponsor, event, resumed } = start;

  // Step 2: create the invoice at PayPal, then commit its id at once.
  if (!resumed) {
    try {
      const created = await createInvoice(client, {
        reference: sponsor.id,
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
      const createdId = created.id;
      await db.transaction(async (tx) => {
        await lockSponsor(tx, sponsor.id);
        if (start.markerId) {
          await tx.update(auditLog).set({ paypalId: createdId }).where(eq(auditLog.id, start.markerId));
        }
        const saved = await tx
          .update(sponsors)
          .set({ paypalInvoiceId: createdId })
          .where(and(eq(sponsors.id, sponsor.id), isNull(sponsors.paypalInvoiceId)))
          .returning({ id: sponsors.id });
        if (saved.length === 0) {
          throw new Error(`${sponsor.name} already has another PayPal invoice; ${createdId} was not recorded on the sponsor`);
        }
      });
    } catch (err) {
      await recordFailure(err);
      throw err;
    }
  }
  const knownId = invoiceId as string | null;
  if (knownId === null) throw new Error('invoice send has no PayPal invoice id');

  // Step 3: send it (unless PayPal already has) and mark the sponsor invoiced.
  let failure: unknown;
  let sent: SentInvoice | undefined;
  await db.transaction(async (tx) => {
    await lockSponsor(tx, sponsor.id);
    try {
      const current = await loadSponsorWithEvent(tx, sponsor.id);
      if (!current) throw new InvoiceRefusedError('sponsor_not_found', 'No such sponsor');
      if (current.sponsor.status === 'paid') {
        throw new InvoiceRefusedError('already_paid', `${sponsor.name} has already paid`);
      }
      if (current.sponsor.status === 'invoiced') {
        throw new InvoiceRefusedError('already_invoiced', `${sponsor.name} has already been invoiced`);
      }
      if (current.sponsor.paypalInvoiceId !== knownId) {
        throw new Error(`${sponsor.name}'s PayPal invoice changed during the send`);
      }

      const existing = resumed ? await getInvoice(client, knownId) : undefined;
      if (existing) {
        if (DEAD.has(existing.status)) {
          throw new InvoiceRefusedError(
            'stale_invoice',
            `PayPal invoice ${knownId} is ${existing.status}; clear it on the sponsor before invoicing again`,
          );
        }
        assertMatchesPledge(existing, current.sponsor, current.event.currency);
      }
      if (!existing || existing.status === 'DRAFT') {
        await sendInvoice(client, knownId, { subject: `Invoice from ${event.name}`, note: draft.note });
      }

      const view = await getInvoice(client, knownId);
      const statusUpdated = await markSponsorInvoiced(tx, sponsor.id);
      await writeAudit(tx, {
        actor,
        action: 'invoice.sent',
        input: { ...auditInput, invoiceNumber: view.invoiceNumber, resumed, statusUpdated },
        reason: draft.reasoning,
        paypalId: knownId,
      });
      sent = {
        paypalInvoiceId: knownId,
        invoiceNumber: view.invoiceNumber,
        recipientViewUrl: view.recipientViewUrl,
        resumed,
      };
    } catch (err) {
      // Commit the trace, then rethrow once out of the transaction.
      failure = err;
      await writeAudit(tx, {
        actor,
        action: 'invoice.failed',
        input: auditInput,
        reason: `failed: ${err instanceof Error ? err.message : String(err)}`,
        paypalId: knownId,
      }).catch(() => undefined);
    }
  });

  if (failure) throw failure;
  if (!sent) throw new Error('invoice send finished without a result');
  return sent;
}
