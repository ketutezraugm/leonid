import type { AgWidgetDefinition } from 'ag-studio-react';
import { BudgetBurn } from './budget-burn';
import { FundingThermometer } from './funding-thermometer';

// Custom widgets for the command center (PRD section 8). Studio's default widgets are kept; these are added.
export const FUNDING_THERMOMETER = 'funding-thermometer';
export const BUDGET_BURN = 'budget-burn';

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
