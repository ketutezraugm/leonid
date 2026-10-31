import type { AgWidgetDefinition } from 'ag-studio-react';
import { BudgetBurn } from './budget-burn';
import { DeliveryRisk } from './delivery-risk';
import { FundingThermometer } from './funding-thermometer';
import { RulesHealth } from './rules-health';

// Custom widgets for the command center (PRD section 8). Studio's default widgets are kept; these are added.
export const FUNDING_THERMOMETER = 'funding-thermometer';
export const BUDGET_BURN = 'budget-burn';
export const RULES_HEALTH = 'rules-health';
export const DELIVERY_RISK = 'delivery-risk';

export const fundingThermometerDefinition: AgWidgetDefinition = {
  id: FUNDING_THERMOMETER,
  label: 'Funding thermometer',
  dataMapping: {
    sponsor: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    pledged: { type: 'field', supportedRoles: ['numeric'], required: true, intent: 'value' },
    invoiced: { type: 'field', supportedRoles: ['numeric'], required: true, intent: 'value' },
    cleared: { type: 'field', supportedRoles: ['numeric'], required: true, intent: 'value' },
  },
  form: (f) =>
    f.createDefaults({
      supportsCrossHighlight: false,
      dataMappingItems: [
        { key: 'sponsor', label: 'Sponsor' },
        { key: 'pledged', label: 'Pledged' },
        { key: 'invoiced', label: 'Invoiced' },
        { key: 'cleared', label: 'Cleared' },
      ],
    }),
  comp: FundingThermometer,
  defaultSize: { width: 480, height: 320 },
  minSize: { width: 240, height: 160 },
};

// The cap is the one optional slot: without it the widget still shows what each category has used.
export const budgetBurnDefinition: AgWidgetDefinition = {
  id: BUDGET_BURN,
  label: 'Budget burn',
  dataMapping: {
    category: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    cap: { type: 'field', supportedRoles: ['numeric'], intent: 'value' },
    spent: { type: 'field', supportedRoles: ['numeric'], required: true, intent: 'value' },
    committed: { type: 'field', supportedRoles: ['numeric'], required: true, intent: 'value' },
  },
  form: (f) =>
    f.createDefaults({
      supportsCrossHighlight: false,
      dataMappingItems: [
        { key: 'category', label: 'Category' },
        { key: 'cap', label: 'Cap' },
        { key: 'spent', label: 'Spent' },
        { key: 'committed', label: 'Committed' },
      ],
    }),
  comp: BudgetBurn,
  defaultSize: { width: 480, height: 360 },
  minSize: { width: 240, height: 160 },
};

// The check, its decision and the reasons are required; the category, amount and day add detail.
export const rulesHealthDefinition: AgWidgetDefinition = {
  id: RULES_HEALTH,
  label: 'Rules health',
  dataMapping: {
    id: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    decision: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    reasons: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    category: { type: 'field', supportedRoles: ['category'], intent: 'category' },
    amount: { type: 'field', supportedRoles: ['numeric'], intent: 'value' },
    date: { type: 'field', supportedRoles: ['category'], intent: 'category' },
  },
  form: (f) =>
    f.createDefaults({
      supportsCrossHighlight: false,
      dataMappingItems: [
        { key: 'id', label: 'Check' },
        { key: 'decision', label: 'Decision' },
        { key: 'reasons', label: 'Reasons' },
        { key: 'category', label: 'Category' },
        { key: 'amount', label: 'Amount' },
        { key: 'date', label: 'Day' },
      ],
    }),
  comp: RulesHealth,
  defaultSize: { width: 480, height: 400 },
  minSize: { width: 240, height: 200 },
};

// The item, its name and its delivery risk are required; the category, the two days and the days late add detail.
export const deliveryRiskDefinition: AgWidgetDefinition = {
  id: DELIVERY_RISK,
  label: 'Delivery risk',
  dataMapping: {
    id: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    name: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    risk: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    category: { type: 'field', supportedRoles: ['category'], intent: 'category' },
    expected: { type: 'field', supportedRoles: ['category'], intent: 'category' },
    deadline: { type: 'field', supportedRoles: ['category'], intent: 'category' },
    daysLate: { type: 'field', supportedRoles: ['numeric'], intent: 'value' },
  },
  form: (f) =>
    f.createDefaults({
      supportsCrossHighlight: false,
      dataMappingItems: [
        { key: 'id', label: 'Item' },
        { key: 'name', label: 'Name' },
        { key: 'risk', label: 'Delivery risk' },
        { key: 'category', label: 'Category' },
        { key: 'expected', label: 'Expected day' },
        { key: 'deadline', label: 'Needed by' },
        { key: 'daysLate', label: 'Days late' },
      ],
    }),
  comp: DeliveryRisk,
  defaultSize: { width: 480, height: 400 },
  minSize: { width: 240, height: 200 },
};
