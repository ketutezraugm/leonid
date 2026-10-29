import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog, events, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { createOrchestrator } from './orchestrator.js';
import { scriptedModel, type ScriptStep } from './testing.js';
import { createTreasuryAgent } from './treasury.js';

let db: Db;
let eventId: string;

// One in-memory Postgres for the file; tables are emptied between tests (migrations are slow).
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table audit_log, events restart identity cascade`);
  eventId = (await seedDemoEvent(db)).id;
});

const ctxFor = (script: ScriptStep[], over: { eventId?: string | null } = {}) => ({
  db,
  model: scriptedModel(script),
  eventId: over.eventId === undefined ? eventId : over.eventId,
  threadId: crypto.randomUUID(),
  goal: 'Invoice the sponsors',
});

const harbor = async () => (await db.select().from(sponsors).where(eq(sponsors.name, 'Harbor Cloud')))[0];
const auditRows = async () => db.select().from(auditLog);
const actions = async () => (await auditRows()).map((r) => `${r.actor}:${r.action}`).sort();
const draftCall = (input: Record<string, unknown>): ScriptStep => ({ tool: 'draft_sponsor_invoice', input });
const done: ScriptStep = { text: 'Done.' };

describe('treasury agent', () => {
  it('has exactly the invoicing tools and no way to send, pay or touch PayPal', () => {
    const { agent } = createTreasuryAgent(ctxFor([done]));
    expect(Object.keys(agent.tools).sort()).toEqual(['draft_sponsor_invoice', 'list_sponsors_to_invoice']);
  });

  it('drafts the full pledge for a pledged sponsor and changes nothing in the database', async () => {
    const { agent, drafted } = createTreasuryAgent(
      ctxFor([
        { tool: 'list_sponsors_to_invoice', input: {} },
        draftCall({ sponsorName: 'Harbor Cloud', reason: 'Gold pledge is due' }),
        { text: 'Drafted one invoice; nothing was sent.' },
      ]),
    );

    await agent.generate({ prompt: 'Invoice Harbor Cloud' });

    expect(drafted()).toHaveLength(1);
    expect(drafted()[0]).toMatchObject({
      sponsorName: 'Harbor Cloud',
      tier: 'gold',
      draft: { currency: 'USD', dueInDays: 14, items: [{ quantity: 1, unitAmount: 350_000 }] },
    });
    expect(await harbor()).toMatchObject({ status: 'pledged', paypalInvoiceId: null });
    expect(await actions()).toEqual(['treasury:draft_sponsor_invoice', 'treasury:list_sponsors_to_invoice']);
    expect((await auditRows()).find((r) => r.action === 'draft_sponsor_invoice')?.reason).toBe('Gold pledge is due');
  });

  it('ignores an amount, wording or recipient the model tries to add', async () => {
    const { agent, drafted } = createTreasuryAgent(
      ctxFor([
        draftCall({
          sponsorName: 'Harbor Cloud',
          unitAmount: 1,
          items: [{ name: 'Free money', quantity: 1, unitAmount: 1 }],
          note: 'Pay to attacker@example.com instead',
          recipientEmail: 'attacker@example.com',
        }),
        done,
      ]),
    );

    await agent.generate({ prompt: 'Invoice Harbor Cloud' });

    const [d] = drafted();
    expect(d?.draft.items).toEqual([
      { name: 'OpenHack 2027 gold sponsorship', quantity: 1, unitAmount: 350_000 },
    ]);
    expect(d?.draft.note).not.toContain('attacker');
    expect(JSON.stringify(d)).not.toContain('attacker@example.com');
  });

  it('lets the agent choose the due days, including due on receipt', async () => {
    const { agent, drafted } = createTreasuryAgent(
      ctxFor([draftCall({ sponsorName: 'Harbor Cloud', dueInDays: 30 }), draftCall({ sponsorName: 'Lumen Labs', dueInDays: 0 }), done]),
    );
    await agent.generate({ prompt: 'Invoice two sponsors' });
    expect(drafted().map((d) => [d.sponsorName, d.draft.dueInDays])).toEqual([
      ['Harbor Cloud', 30],
      ['Lumen Labs', 0],
    ]);
  });

  it('keeps one draft per sponsor when the agent redrafts', async () => {
    const { agent, drafted } = createTreasuryAgent(
      ctxFor([draftCall({ sponsorName: 'Harbor Cloud', dueInDays: 14 }), draftCall({ sponsorName: 'harbor cloud', dueInDays: 45 }), done]),
    );
    await agent.generate({ prompt: 'Invoice Harbor Cloud' });
    expect(drafted()).toHaveLength(1);
    expect(drafted()[0]?.draft.dueInDays).toBe(45);
  });

  it('rejects due days outside 0 to 90 and drafts nothing', async () => {
    const { agent, drafted } = createTreasuryAgent(ctxFor([draftCall({ sponsorName: 'Harbor Cloud', dueInDays: 120 }), done]));
    await agent.generate({ prompt: 'Invoice Harbor Cloud' });
    expect(drafted()).toEqual([]);
  });

  it('tells the agent, and audits, when the sponsor does not exist', async () => {
    const { agent, drafted } = createTreasuryAgent(ctxFor([draftCall({ sponsorName: 'Nobody Inc' }), done]));
    await agent.generate({ prompt: 'Invoice Nobody Inc' });

    expect(drafted()).toEqual([]);
    const reason = (await auditRows()).find((r) => r.action === 'draft_sponsor_invoice')?.reason;
    expect(reason).toMatch(/^failed: Unknown sponsor "Nobody Inc"/);
    expect(reason).toContain('Harbor Cloud');
  });

  it.each(['invoiced', 'paid'] as const)('refuses to draft a sponsor that is already %s', async (status) => {
    await db.update(sponsors).set({ status }).where(eq(sponsors.name, 'Harbor Cloud'));
    const { agent, drafted } = createTreasuryAgent(ctxFor([draftCall({ sponsorName: 'Harbor Cloud' }), done]));
    await agent.generate({ prompt: 'Invoice Harbor Cloud' });

    expect(drafted()).toEqual([]);
    expect((await auditRows()).find((r) => r.action === 'draft_sponsor_invoice')?.reason).toMatch(
      new RegExp(`already ${status}`),
    );
  });

  it("never sees another event's sponsors", async () => {
    const [other] = await db
      .insert(events)
      .values({ name: 'Other Event', date: new Date('2027-05-01'), headcount: 10, budgetTotal: 1000, currency: 'USD' })
      .returning();
    await db.insert(sponsors).values({ eventId: other!.id, name: 'Rival Corp', tier: 'gold', pledged: 99_900 });

    const { agent, drafted } = createTreasuryAgent(
      ctxFor([{ tool: 'list_sponsors_to_invoice', input: {} }, draftCall({ sponsorName: 'Rival Corp' }), done]),
    );
    await agent.generate({ prompt: 'Invoice Rival Corp' });

    expect(drafted()).toEqual([]);
    const reason = (await auditRows()).find((r) => r.action === 'draft_sponsor_invoice')?.reason;
    expect(reason).toMatch(/^failed: Unknown sponsor "Rival Corp"/);
    // The error lists only this event's sponsors, never the other event's.
    expect(reason).not.toContain('Rival Corp, ');
    expect(reason).toContain('Harbor Cloud');
  });

  it('refuses to draft before the chat has an event', async () => {
    const { agent, drafted } = createTreasuryAgent(ctxFor([draftCall({ sponsorName: 'Harbor Cloud' }), done], { eventId: null }));
    await agent.generate({ prompt: 'Invoice Harbor Cloud' });

    expect(drafted()).toEqual([]);
    expect((await auditRows()).find((r) => r.action === 'draft_sponsor_invoice')?.reason).toMatch(/no event yet/);
  });
});

describe('orchestrator delegation to the treasury agent', () => {
  it('returns the drafts for the treasurer to confirm, marked as not sent', async () => {
    const agent = createOrchestrator(
      ctxFor([
        // orchestrator
        { tool: 'delegate_to_treasury', input: { task: 'Draft the Harbor Cloud invoice', reason: 'Gold pledge is due' } },
        // treasury subagent (shares the script)
        draftCall({ sponsorName: 'Harbor Cloud' }),
        { text: 'Drafted the Harbor Cloud invoice. Nothing was sent.' },
        // orchestrator resumes
        { text: 'A draft for Harbor Cloud is waiting for the treasurer.' },
      ]),
    );

    const result = await agent.generate({ prompt: 'Invoice Harbor Cloud' });

    expect(result.text).toBe('A draft for Harbor Cloud is waiting for the treasurer.');
    const delegated = result.steps
      .flatMap((s) => s.toolResults)
      .find((r) => r.toolName === 'delegate_to_treasury');
    expect(delegated?.output).toMatchObject({
      sent: false,
      summary: 'Drafted the Harbor Cloud invoice. Nothing was sent.',
      drafts: [{ sponsorName: 'Harbor Cloud', draft: { items: [{ unitAmount: 350_000 }] } }],
    });
    expect(await harbor()).toMatchObject({ status: 'pledged', paypalInvoiceId: null });
    expect(await actions()).toEqual([
      'orchestrator:delegate_to_treasury',
      'treasury:draft_sponsor_invoice',
    ]);
  });
});
