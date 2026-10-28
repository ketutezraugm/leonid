import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat } from 'ag-studio';
import type {
  BudgetBurnData,
  DeliveryRiskData,
  FundingThermometerData,
  PayoutsLedgerData,
  RulesHealthData,
} from '@quartermaster/shared';

// The widget payloads the command center reads. Each comes from one API endpoint, backed by the ledger.
export type CommandCenterData = {
  funding: FundingThermometerData;
  budget: BudgetBurnData;
  payouts: PayoutsLedgerData;
  rules: RulesHealthData;
  delivery: DeliveryRiskData;
};

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

// The contract carries integer cents; Studio's currency format expects dollars. This is the only place that converts.
const dollars = (cents: number) => cents / 100;

export type StudioTable = {
  id: string;
  name: string;
  description: string;
  data: Record<string, string | number | null>[];
  fields: AgFieldDefinition[];
};

export function buildStudioData(data: CommandCenterData): AgDataSourcesDefinition {
  return {
    description:
      'Money for one community event, from PayPal webhooks recorded in the ledger. Amounts are USD dollars. ' +
      'Cleared means PayPal confirmed the money; pledged and invoiced are not spendable until they clear.',
    sources: buildTables(data),
  };
}

export function buildTables(data: CommandCenterData): StudioTable[] {
  return [
    {
      id: 'sponsors',
      name: 'Sponsor funding',
      description:
        'One row per sponsor: pledged, invoiced and cleared amounts. Outstanding is invoiced minus cleared.',
      data: data.funding.sponsors.map((s) => ({
        id: s.sponsorId,
        name: s.name,
        tier: s.tier,
        pledged: dollars(s.pledged),
        invoiced: dollars(s.invoiced),
        cleared: dollars(s.cleared),
        outstanding: dollars(s.invoiced - s.cleared),
      })),
      fields: fields([
        ['id', 'Sponsor ID', 'textFormat', true],
        ['name', 'Sponsor', 'textFormat'],
        ['tier', 'Tier', 'textFormat'],
        ['pledged', 'Pledged', 'currencyFormat'],
        ['invoiced', 'Invoiced', 'currencyFormat'],
        ['cleared', 'Cleared', 'currencyFormat'],
        ['outstanding', 'Outstanding', 'currencyFormat'],
      ]),
    },
    {
      id: 'categories',
      name: 'Budget categories',
      description:
        'One row per budget category: cap, captured spend and committed spend (approved but not yet captured).',
      data: data.budget.categories.map((c) => ({
        category: c.category,
        cap: c.cap === null ? null : dollars(c.cap),
        spent: dollars(c.spent),
        committed: dollars(c.committed),
        used: dollars(c.spent + c.committed),
      })),
      fields: fields([
        ['category', 'Category', 'textFormat'],
        ['cap', 'Cap', 'currencyFormat'],
        ['spent', 'Spent', 'currencyFormat'],
        ['committed', 'Committed', 'currencyFormat'],
        ['used', 'Spent and committed', 'currencyFormat'],
      ]),
    },
    {
      id: 'payouts',
      name: 'Payouts ledger',
      description: 'Claims, speaker payments and prizes with their status.',
      data: data.payouts.rows.map((p) => ({
        id: p.id,
        recipient: p.recipientName,
        kind: p.kind,
        wallet: p.destination.wallet,
        country: p.destination.countryCode,
        category: p.category,
        sponsorId: p.sponsorId,
        amount: dollars(p.amount),
        status: p.status,
      })),
      fields: fields([
        ['id', 'Payout item ID', 'textFormat', true],
        ['recipient', 'Recipient', 'textFormat'],
        ['kind', 'Kind', 'textFormat'],
        ['wallet', 'Wallet', 'textFormat'],
        ['country', 'Country', 'textFormat'],
        ['category', 'Category', 'textFormat'],
        ['sponsorId', 'Sponsor ID', 'textFormat', true],
        ['amount', 'Amount', 'currencyFormat'],
        ['status', 'Status', 'textFormat'],
      ]),
    },
    {
      id: 'rules',
      name: 'Rules checks',
      description: 'Recent spend checks by the rules engine, with the decision and the reasons.',
      data: data.rules.recent.map((r) => ({
        id: r.auditId,
        date: r.at.slice(0, 10),
        actor: r.actor,
        action: r.action,
        category: r.category,
        amount: r.amount === null ? null : dollars(r.amount),
        decision: r.result.decision,
        reasons: r.result.reasons.join('; '),
      })),
      fields: fields([
        ['id', 'Audit ID', 'textFormat', true],
        ['date', 'Date', 'dateFormat'],
        ['actor', 'Actor', 'textFormat'],
        ['action', 'Action', 'textFormat'],
        ['category', 'Category', 'textFormat'],
        ['amount', 'Amount', 'currencyFormat'],
        ['decision', 'Decision', 'textFormat'],
        ['reasons', 'Reasons', 'textFormat'],
      ]),
    },
    {
      id: 'deliveries',
      name: 'Delivery risk',
      description:
        'Ordered items with expected arrival against their deadline. Days late is positive when past the deadline.',
      data: data.delivery.items.map((d) => ({
        id: d.orderId,
        name: d.name,
        category: d.category,
        expected: d.expectedDelivery,
        deadline: d.deadline,
        daysLate: d.daysLate,
        risk: d.risk,
      })),
      fields: fields([
        ['id', 'Order ID', 'textFormat', true],
        ['name', 'Item', 'textFormat'],
        ['category', 'Category', 'textFormat'],
        ['expected', 'Expected delivery', 'dateFormat'],
        ['deadline', 'Deadline', 'dateFormat'],
        ['daysLate', 'Days late', 'integerFormat'],
        ['risk', 'Risk', 'textFormat'],
      ]),
    },
  ];
}
