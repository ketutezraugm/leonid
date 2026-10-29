import { describe, expect, it } from 'vitest';
import {
  BudgetBurnData,
  Claim,
  DeliveryRiskData,
  FundingThermometerData,
  Invoice,
  InvoiceDraft,
  LedgerEntry,
  PayoutBatch,
  PayoutDestination,
  PayoutItem,
  PayoutsLedgerData,
  ReceiptExtraction,
  RulesHealthData,
  Sponsor,
  WidgetFilter,
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
    wallet: 'PAYPAL',
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
    const reversal = { ...entry, direction: 'out', source: 'income_reversal', paypalId: 'REF-1', captureId: 'CAP-1' };
    expect(LedgerEntry.parse(reversal).source).toBe('income_reversal');
  });
});

describe('Payouts', () => {
  it('accepts a PayPal email item', () => {
    expect(PayoutItem.parse(item).destination.wallet).toBe('PAYPAL');
  });

  it('accepts a Venmo handle on the Venmo wallet', () => {
    const venmo = {
      recipientType: 'USER_HANDLE',
      receiver: '@ada-w',
      wallet: 'VENMO',
      countryCode: 'US',
    };
    expect(PayoutDestination.safeParse(venmo).success).toBe(true);
  });

  it('rejects a Venmo handle on the PayPal wallet', () => {
    const bad = {
      recipientType: 'USER_HANDLE',
      receiver: '@ada-w',
      wallet: 'PAYPAL',
      countryCode: 'US',
    };
    expect(PayoutDestination.safeParse(bad).success).toBe(false);
  });

  it('rejects PHONE recipients, which the sandbox does not support', () => {
    const phone = {
      recipientType: 'PHONE',
      receiver: '+14155550123',
      wallet: 'PAYPAL',
      countryCode: 'US',
    };
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
      recipientType: 'USER_HANDLE',
      receiver: '@sam-v',
      wallet: 'VENMO',
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
