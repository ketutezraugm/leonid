import { useEffect, useMemo } from 'react';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { commandCenterReport } from './initial-report';
import { sampleCommandCenterData } from './sample-data';
import { buildStudioData } from './studio-data';
import { quartermasterStudioTheme } from './studio-theme';
import { reportState, startFrom } from './widgets/filters-changed';
import {
  budgetBurnDefinition,
  deliveryRiskDefinition,
  fundingThermometerDefinition,
  rulesHealthDefinition,
} from './widgets/definitions';

// Studio's default widgets stay available; the command center's own are added to them.
const withCustomWidgets = <T extends { widgets: readonly unknown[] }>(defaults: T) => ({
  ...defaults,
  widgets: [
    ...defaults.widgets,
    fundingThermometerDefinition,
    budgetBurnDefinition,
    rulesHealthDefinition,
    deliveryRiskDefinition,
  ],
});

// Default export so the Money page can lazy-load it: AG Studio is a large bundle.
export default function CommandCenter() {
  const data = useMemo(() => buildStudioData(sampleCommandCenterData), []);
  // Studio reports changes to the filters, not what they start as, and each visit to this page starts again
  // from the default report: say so, or the first selection would be taken for the starting point.
  useEffect(() => startFrom(commandCenterReport), []);
  return (
    <AgStudioProvider licenseKey={import.meta.env.VITE_AG_STUDIO_LICENSE || undefined}>
      <AgStudio
        style={{ height: '75vh', width: '100%' }}
        theme={quartermasterStudioTheme}
        layout={{ widgetBorderEnabled: true }}
        data={data}
        widgets={withCustomWidgets}
        initialState={commandCenterReport}
        mode="view"
        // Studio does not tell a custom widget that another widget's selection changed the filters, so the
        // widgets that list rows are told here (see widgets/filters-changed.ts).
        onStateUpdated={(event) => reportState(event.state)}
      />
    </AgStudioProvider>
  );
}
