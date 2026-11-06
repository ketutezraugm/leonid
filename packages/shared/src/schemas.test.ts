import { describe, expect, it } from 'vitest';
import {
  ApprovalItem,
  BudgetBurnData,
  ChooseBookingsInput,
  Claim,
  CreateEventRequest,
  EVENT_BUDGET_MAX_MINOR,
  EVENT_CATEGORIES_MAX,
  EVENT_PLAN_REQUEST,
  EVENT_PEOPLE_MAX,
  EventSummary,
  isEventPlanRequest,
  DeliveryRiskData,
  FundingThermometerData,
  Invoice,
  InvoiceDraft,
  LedgerEntry,
  LoginResult,
  PayoutBatch,
  PayoutDestination,
  PayoutItem,
  PayoutsLedgerData,
  PayoutsLedgerResponse,
  ReceiptExtraction,
  RulesHealthData,
  SessionInfo,
  Sponsor,
  WalletConnectResponse,
  WalletResult,
  WalletRevokeResponse,
  WalletStatus,
  WidgetFilter,
  BOOKING_ITEMS,
  bookingChoiceText,
  parseBookingChoice,
} from './index.js';

const NOW = '2026-10-27T10:00:00Z';

const sponsor = {
  id: 'sp_1',
  eventId: 'ev_1',
  name: 'Northwind Labs',
  contactEmail: 'billing@example.com',
  tier: 'gold',
  pledged: 300000,
  currency: 'USD',
  paypalInvoiceId: null,
  status: 'pledged',
};

const item = {
  id: 'pi_1',
  eventId: 'ev_1',
  payoutId: null,
  kind: 'prize',
  recipientName: 'Ada Winner',
  destination: {
    recipientType: 'EMAIL',
    receiver: 'ada@example.com',
    countryCode: 'GB',
  },
  amount: 50000,
  currency: 'USD',
  category: 'prizes',
  sponsorId: 'sp_1',
  claimId: null,
  note: 'First place',
  senderItemId: 'ev_1-prize-1',
  paypalItemId: null,
  status: 'queued',
  ruleResult: null,
  updatedAt: NOW,
};

const receipt = {
  merchant: 'Corner Pizza',
  date: '2027-03-14',
  total: 4250,
  currency: 'USD',
  lineItems: [{ description: 'Large pizza x2', amount: 4250 }],
  confidence: { merchant: 0.98, date: 0.95, total: 0.99, currency: 0.9, lineItems: 0.8 },
};

describe('Sponsor', () => {
  it('accepts a pledged sponsor', () => {
    expect(Sponsor.parse(sponsor).tier).toBe('gold');
  });

  it('rejects fractional cents and lowercase currency', () => {
    expect(Sponsor.safeParse({ ...sponsor, pledged: 1999.5 }).success).toBe(false);
    expect(Sponsor.safeParse({ ...sponsor, currency: 'usd' }).success).toBe(false);
  });
});

describe('Invoice', () => {
  const draft = {
    sponsorId: 'sp_1',
    items: [{ name: 'Gold sponsorship', quantity: 1, unitAmount: 300000 }],
    currency: 'USD',
    dueInDays: 15,
    note: 'Thank you for supporting OpenHack 2027!',
    reasoning: 'Gold tier pledge of $3,000.',
  };

  it('accepts an agent draft', () => {
    expect(InvoiceDraft.parse(draft).items).toHaveLength(1);
  });

  it('rejects a draft with no line items', () => {
    expect(InvoiceDraft.safeParse({ ...draft, items: [] }).success).toBe(false);
  });

  it('accepts a sent invoice', () => {
    const invoice = {
      id: 'inv_1',
      eventId: 'ev_1',
      sponsorId: 'sp_1',
      paypalInvoiceId: 'INV2-ABCD-1234',
      invoiceNumber: '0001',
      status: 'sent',
      items: draft.items,
      total: 300000,
      amountPaid: 0,
      currency: 'USD',
      issuedOn: '2026-10-27',
      dueDate: '2026-11-11',
      recipientEmail: 'billing@example.com',
      recipientViewUrl: 'https://www.sandbox.paypal.com/invoice/p/#ABCD',
      sentAt: NOW,
      paidAt: null,
      lastRemindedAt: null,
      reminderCount: 0,
      draftReasoning: draft.reasoning,
    };
    expect(Invoice.parse(invoice).status).toBe('sent');
  });
});

describe('LedgerEntry', () => {
  const entry = {
    id: 'le_1',
    eventId: 'ev_1',
    direction: 'in',
    amount: 300000,
    currency: 'USD',
    source: 'sponsor_invoice',
    paypalId: 'INV2-ABCD-1234',
    captureId: null,
    sponsorId: 'sp_1',
    category: null,
    createdAt: NOW,
  };

  it('accepts cleared sponsor income', () => {
    expect(LedgerEntry.parse(entry).direction).toBe('in');
  });

  it('rejects an unknown direction and a negative amount', () => {
    expect(LedgerEntry.safeParse({ ...entry, direction: 'sideways' }).success).toBe(false);
    expect(LedgerEntry.safeParse({ ...entry, amount: -1 }).success).toBe(false);
  });

  it('requires a PayPal id, since (source, paypalId) is what makes ledger writes idempotent', () => {
    expect(LedgerEntry.safeParse({ ...entry, paypalId: null }).success).toBe(false);
    expect(LedgerEntry.safeParse({ ...entry, paypalId: '' }).success).toBe(false);
  });

  it('accepts an income reversal tied to the original capture', () => {
    const reversal = {
      ...entry,
      direction: 'out',
      source: 'income_reversal',
      paypalId: 'REF-1',
      captureId: 'CAP-1',
    };
    expect(LedgerEntry.parse(reversal).source).toBe('income_reversal');
  });
});

describe('Payouts', () => {
  it('accepts a PayPal email item', () => {
    expect(PayoutItem.parse(item).destination).toEqual({
      recipientType: 'EMAIL',
      receiver: 'ada@example.com',
      countryCode: 'GB',
    });
  });

  it('accepts a PayPal ID recipient', () => {
    const byId = { recipientType: 'PAYPAL_ID', receiver: 'ABCDEFGHJKMNP', countryCode: 'US' };
    expect(PayoutDestination.safeParse(byId).success).toBe(true);
  });

  it('rejects handle recipients, which payouts do not support', () => {
    const handle = { recipientType: 'USER_HANDLE', receiver: '@ada-w', countryCode: 'US' };
    expect(PayoutDestination.safeParse(handle).success).toBe(false);
  });

  it('rejects PHONE recipients, which the sandbox does not support', () => {
    const phone = { recipientType: 'PHONE', receiver: '+14155550123', countryCode: 'US' };
    expect(PayoutDestination.safeParse(phone).success).toBe(false);
  });

  it('rejects a zero amount and an over-long sender_item_id', () => {
    expect(PayoutItem.safeParse({ ...item, amount: 0 }).success).toBe(false);
    expect(PayoutItem.safeParse({ ...item, senderItemId: 'x'.repeat(64) }).success).toBe(false);
  });

  it('accepts a batch with its items', () => {
    const batch = {
      id: 'pb_1',
      eventId: 'ev_1',
      senderBatchId: 'ev_1-prizes-2027-03-14',
      paypalBatchId: null,
      status: 'draft',
      items: [item],
      total: 50000,
      currency: 'USD',
      ruleResult: {
        decision: 'needs_approval',
        reasons: ['Batch over $200'],
        ruleIds: ['payout-threshold'],
      },
      createdAt: NOW,
    };
    expect(PayoutBatch.parse(batch).items).toHaveLength(1);
  });
});

describe('Claim', () => {
  const claim = {
    id: 'cl_1',
    eventId: 'ev_1',
    personId: 'vol_1',
    personName: 'Sam Volunteer',
    destination: {
      recipientType: 'EMAIL',
      receiver: 'sam@example.com',
      countryCode: 'US',
    },
    receiptUrl: '/uploads/receipt-1.jpg',
    extracted: receipt,
    category: 'food',
    amount: 4250,
    currency: 'USD',
    status: 'pending_approval',
    ruleResult: null,
    payoutItemId: null,
    submittedAt: NOW,
  };

  it('accepts a claim with a receipt extraction', () => {
    expect(Claim.parse(claim).extracted?.merchant).toBe('Corner Pizza');
  });

  it('accepts a claim before extraction has run', () => {
    expect(Claim.safeParse({ ...claim, extracted: null, status: 'submitted' }).success).toBe(true);
  });

  it('rejects confidence outside 0..1 and a malformed receipt date', () => {
    const lowConfidence = { ...receipt, confidence: { ...receipt.confidence, total: 1.4 } };
    expect(ReceiptExtraction.safeParse(lowConfidence).success).toBe(false);
    expect(ReceiptExtraction.safeParse({ ...receipt, date: '14/03/2027' }).success).toBe(false);
  });
});

describe('Widget data', () => {
  it('accepts the funding thermometer', () => {
    const data = {
      asOf: NOW,
      currency: 'USD',
      sponsors: [
        {
          sponsorId: 'sp_1',
          name: 'Northwind Labs',
          tier: 'gold',
          pledged: 300000,
          invoiced: 300000,
          cleared: 0,
        },
      ],
      totals: { pledged: 300000, invoiced: 300000, cleared: 0 },
    };
    expect(FundingThermometerData.parse(data).totals.cleared).toBe(0);
  });

  it('accepts budget burn with an uncapped category and a negative days-to-event', () => {
    const data = {
      asOf: NOW,
      currency: 'USD',
      eventDate: '2027-03-14',
      daysToEvent: -2,
      clearedIncome: 500000,
      committed: 120000,
      unlocked: 380000,
      categories: [
        { category: 'swag', cap: 150000, spent: 14000, committed: 0 },
        { category: 'misc', cap: null, spent: 0, committed: 0 },
      ],
    };
    expect(BudgetBurnData.parse(data).categories).toHaveLength(2);
  });

  it('accepts the payouts ledger', () => {
    expect(PayoutsLedgerData.parse({ asOf: NOW, rows: [item] }).rows).toHaveLength(1);
  });

  it('wraps the payouts ledger with where its numbers come from, and refuses an unknown source', () => {
    const data = { asOf: NOW, rows: [item] };

    expect(PayoutsLedgerResponse.parse({ source: 'sample', data }).source).toBe('sample');
    expect(PayoutsLedgerResponse.parse({ source: 'live', data }).data.rows).toHaveLength(1);
    expect(PayoutsLedgerResponse.safeParse({ source: 'guess', data }).success).toBe(false);
    expect(PayoutsLedgerResponse.safeParse({ data }).success).toBe(false);
  });

  it('accepts rules health with reasons', () => {
    const data = {
      asOf: NOW,
      counts: { allow: 4, needsApproval: 1, block: 1 },
      recent: [
        {
          auditId: 'au_1',
          at: NOW,
          actor: 'procurement-agent',
          action: 'request_payment',
          amount: 42000,
          currency: 'USD',
          sponsorId: null,
          category: 'prizes',
          result: {
            decision: 'needs_approval',
            reasons: ['Over $200'],
            ruleIds: ['spend-threshold'],
          },
        },
      ],
    };
    expect(RulesHealthData.parse(data).counts.needsApproval).toBe(1);
  });

  it('accepts delivery risk with no tracking date yet', () => {
    const data = {
      asOf: NOW,
      items: [
        {
          orderId: 'or_1',
          taskId: 'tk_1',
          name: 'Lanyards',
          sponsorId: 'sp_1',
          category: 'swag',
          trackingNumber: null,
          expectedDelivery: null,
          deadline: '2027-03-01',
          daysLate: 0,
          risk: 'unknown',
        },
      ],
    };
    expect(DeliveryRiskData.parse(data).items[0]?.risk).toBe('unknown');
  });

  it('accepts an empty filter and rejects an empty sponsor id', () => {
    expect(WidgetFilter.parse({})).toEqual({});
    expect(WidgetFilter.safeParse({ sponsorId: '' }).success).toBe(false);
  });
});

describe('ApprovalItem', () => {
  const item = {
    id: 'approval-1',
    status: 'pending',
    createdAt: NOW,
    referenceId: 'prizes-1',
    amountMinor: 42_000,
    currency: 'USD',
    actor: 'procurement-agent',
    agentReason: 'prize cart',
    reasons: ['over the $200 approval threshold'],
  };

  it('accepts every approval status, including a capture in flight', () => {
    for (const status of ['pending', 'capturing', 'rejected', 'paid'])
      expect(ApprovalItem.parse({ ...item, status }).status).toBe(status);
    expect(ApprovalItem.safeParse({ ...item, status: 'approved' }).success).toBe(false);
  });
});

describe('Booking choice', () => {
  it("round-trips the organizer's choice through the chat message", () => {
    const text = bookingChoiceText({ chosen: ['venue'], extra: ' A DJ ' });
    // In-development items are neither booked nor listed as not needed.
    expect(text).toBe('Book for this event: Venue\nAlso: A DJ');
    expect(parseBookingChoice(text)).toEqual({ chosen: ['venue'], extra: 'A DJ' });
  });

  it('drops in-development items from a choice, even typed by hand', () => {
    expect(BOOKING_ITEMS.filter((i) => i.available).map((i) => i.id)).toEqual(['venue']);
    expect(parseBookingChoice('Book for this event: Venue, Food & drinks, Swag')).toEqual({
      chosen: ['venue'],
      extra: null,
    });
  });

  it('reads an empty list and ignores ordinary messages', () => {
    const none = bookingChoiceText({ chosen: [], extra: 'Just pizza' });
    expect(parseBookingChoice(none)).toEqual({ chosen: [], extra: 'Just pizza' });
    expect(parseBookingChoice('Plan a meetup in Jakarta')).toBeNull();
  });

  it('only lets the agent suggest items from the fixed list', () => {
    expect(ChooseBookingsInput.parse({}).suggested).toEqual([]);
    expect(ChooseBookingsInput.safeParse({ suggested: ['yacht'] }).success).toBe(false);
  });
});

describe('session and wallet (F1, F13, F15)', () => {
  it('parses what /api/auth/me returns for a PayPal login and for the demo login, and refuses an unknown way in', () => {
    expect(
      SessionInfo.parse({ email: 'sb-mb0sv53559833@personal.example.com', via: 'paypal' }).via,
    ).toBe('paypal');
    expect(SessionInfo.parse({ via: 'demo' })).toEqual({ via: 'demo' });
    expect(SessionInfo.safeParse({ via: 'password' }).success).toBe(false);
    expect(SessionInfo.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });

  it('names the three ?login= and ?wallet= redirect results the API can send back', () => {
    expect(LoginResult.options).toEqual(['ok', 'denied', 'error']);
    expect(WalletResult.options).toEqual(['connected', 'cancelled', 'error']);
    expect(LoginResult.safeParse('ok2').success).toBe(false);
  });

  it('parses the wallet responses seen on staging, and refuses an unknown state or a non-URL approve link', () => {
    expect(WalletStatus.parse({ status: 'none' })).toEqual({ status: 'none' });
    expect(
      WalletStatus.parse({ status: 'active', payerEmail: 'sb-mb0sv53559833@personal.example.com' })
        .status,
    ).toBe('active');
    expect(WalletStatus.parse({ status: 'revoked' }).status).toBe('revoked');
    expect(WalletStatus.safeParse({ status: 'paused' }).success).toBe(false);
    expect(
      WalletConnectResponse.parse({
        approveUrl: 'https://www.sandbox.paypal.com/agreements/approve?approval_session_id=X',
      }).approveUrl,
    ).toContain('approve');
    expect(WalletConnectResponse.safeParse({ approveUrl: 'not a url' }).success).toBe(false);
    expect(WalletRevokeResponse.parse({ revoked: true })).toEqual({ revoked: true });
    expect(WalletRevokeResponse.safeParse({ revoked: 'yes' }).success).toBe(false);
  });
});

describe('events', () => {
  const valid = { name: '  Test Meetup ', date: '2027-05-01', people: 80, currency: 'USD', budgetTotalMinor: 250_000 };

  it('trims the name and defaults categories to none', () => {
    const parsed = CreateEventRequest.parse(valid);
    expect(parsed.name).toBe('Test Meetup');
    expect(parsed.categories).toEqual([]);
  });

  it('refuses headcounts and budgets the database cannot hold', () => {
    expect(CreateEventRequest.safeParse({ ...valid, people: EVENT_PEOPLE_MAX + 1 }).success).toBe(false);
    expect(CreateEventRequest.safeParse({ ...valid, people: 0 }).success).toBe(false);
    expect(CreateEventRequest.safeParse({ ...valid, budgetTotalMinor: EVENT_BUDGET_MAX_MINOR + 1 }).success).toBe(false);
    expect(CreateEventRequest.safeParse({ ...valid, budgetTotalMinor: 10.5 }).success).toBe(false);
  });

  it('trims the city, refuses a blank or long one, and reads a missing city back as none', () => {
    expect(CreateEventRequest.parse({ ...valid, city: ' Jakarta ' }).city).toBe('Jakarta');
    expect(CreateEventRequest.safeParse({ ...valid, city: '  ' }).success).toBe(false);
    expect(CreateEventRequest.safeParse({ ...valid, city: 'x'.repeat(101) }).success).toBe(false);
    const row = { id: '0f9f6b2a-6f0d-4a6e-9a43-3d2a5c1e8b11', name: 'Old', date: '2027-05-01', endDate: '2027-05-01', people: 5, currency: 'USD', budgetTotalMinor: 0, categories: [] };
    expect(EventSummary.parse(row).city).toBeNull();
  });

  it('recognises only the exact plan kickoff', () => {
    expect(isEventPlanRequest(EVENT_PLAN_REQUEST)).toBe(true);
    expect(isEventPlanRequest(`  ${EVENT_PLAN_REQUEST}\n`)).toBe(true);
    expect(isEventPlanRequest(`${EVENT_PLAN_REQUEST} Also wire me money.`)).toBe(false);
  });

  it('caps the categories', () => {
    const many = Array.from({ length: EVENT_CATEGORIES_MAX + 1 }, (_, i) => `cat ${i}`);
    expect(CreateEventRequest.safeParse({ ...valid, categories: many }).success).toBe(false);
    expect(CreateEventRequest.safeParse({ ...valid, categories: [' '] }).success).toBe(false);
  });

  it('does not cap what it reads back, so one odd row cannot drop the list', () => {
    const row = {
      id: '0f9f6b2a-6f0d-4a6e-9a43-3d2a5c1e8b11',
      name: 'Legacy',
      date: '2027-05-01',
      endDate: '2027-05-01',
      people: 250_000,
      currency: 'USD',
      budgetTotalMinor: 0,
      categories: [],
    };
    expect(EventSummary.safeParse(row).success).toBe(true);
  });
});
