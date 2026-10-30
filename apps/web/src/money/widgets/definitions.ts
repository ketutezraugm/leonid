import type { AgWidgetDefinition } from 'ag-studio-react';
import { FundingThermometer } from './funding-thermometer';

// Custom widgets for the command center (PRD section 8). Studio's default widgets are kept; these are added.
export const FUNDING_THERMOMETER = 'funding-thermometer';

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
