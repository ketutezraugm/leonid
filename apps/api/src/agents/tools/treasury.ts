import { InvoiceDraft } from '@quartermaster/shared';
import { tool } from 'ai';
import { z } from 'zod';
import { getEvent, listSponsors } from '../../db/events.js';
import { buildSponsorInvoiceDraft } from '../../invoices/draft.js';
import { auditedExecute, requireEvent, type AgentContext } from '../context.js';

const reason = z.string().max(300).optional().describe('One sentence: why');

// What the treasurer needs to confirm one draft: enough to show it and to call POST /api/sponsors/:id/send.
export interface DraftedInvoice {
  sponsorId: string;
  sponsorName: string;
  tier: string;
  draft: InvoiceDraft;
}

// Read-only. Names, tiers, pledges and status of this chat's event only.
export function listSponsorsToInvoiceTool(ctx: AgentContext) {
  return tool({
    description:
      "List this event's sponsors with their tier, pledged amount in cents and invoice status. " +
      "Only sponsors with status 'pledged' can be drafted; 'invoiced' and 'paid' already were.",
    inputSchema: z.object({ reason }),
    execute: auditedExecute(ctx, 'treasury', 'list_sponsors_to_invoice', async () => {
      const sponsors = await listSponsors(ctx.db, requireEvent(ctx));
      return {
        sponsors: sponsors.map((s) => ({
          name: s.name,
          tier: s.tier,
          pledgedCents: s.pledged,
          status: s.status,
          canDraft: s.status === 'pledged',
        })),
      };
    }),
  });
}

const DraftInput = z.object({
  sponsorName: z.string().trim().min(1).max(120).describe('Exact sponsor name from list_sponsors_to_invoice'),
  dueInDays: z
    .number()
    .int()
    .min(0)
    .max(90)
    .optional()
    .describe('Days until due, 0 for due on receipt. Leave out for the default.'),
  reason,
});

// Prepares an invoice draft and nothing else. The agent chooses the sponsor and, optionally, the due
// days. The amount is the pledge, the wording is ours and the recipient is typed by the treasurer, so
// nothing the agent (or text it read) says can change what a sponsor is asked to pay. Sending is a
// separate, treasurer-only step (routes/invoices.ts) that this tool cannot reach.
export function draftSponsorInvoiceTool(ctx: AgentContext, onDraft?: (drafted: DraftedInvoice) => void) {
  return tool({
    description:
      'Prepare an invoice draft for one pledged sponsor of this event. This only drafts: it does not ' +
      'send anything, and a human treasurer must review and send it. The amount is always the full pledge.',
    inputSchema: DraftInput,
    execute: auditedExecute(ctx, 'treasury', 'draft_sponsor_invoice', async ({ sponsorName, dueInDays }) => {
      const eventId = requireEvent(ctx);
      const sponsors = await listSponsors(ctx.db, eventId);
      const wanted = sponsorName.toLowerCase();
      const matches = sponsors.filter((s) => s.name.toLowerCase() === wanted);
      const sponsor = matches[0];
      if (!sponsor) {
        throw new Error(`Unknown sponsor "${sponsorName}". Sponsors of this event: ${sponsors.map((s) => s.name).join(', ') || 'none'}`);
      }
      if (matches.length > 1) throw new Error(`Several sponsors are named "${sponsorName}"; ask the organizer which one`);
      if (sponsor.status !== 'pledged') {
        throw new Error(`${sponsor.name} is already ${sponsor.status}; only pledged sponsors can be invoiced`);
      }
      const event = await getEvent(ctx.db, eventId);
      if (!event) throw new Error('Event not found');

      const base = buildSponsorInvoiceDraft(sponsor, event);
      const draft = InvoiceDraft.parse({ ...base, dueInDays: dueInDays ?? base.dueInDays });
      onDraft?.({ sponsorId: sponsor.id, sponsorName: sponsor.name, tier: sponsor.tier, draft });
      return {
        drafted: true,
        status: 'awaiting_treasurer_confirmation',
        sponsor: sponsor.name,
        draft,
        next: 'Nothing was sent. The treasurer must review this draft and enter the sponsor email to send it.',
      };
    }),
  });
}
