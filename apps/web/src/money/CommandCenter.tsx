import { useMemo } from 'react';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { commandCenterReport } from './initial-report';
import { sampleCommandCenterData } from './sample-data';
import { buildStudioData } from './studio-data';
import { quartermasterStudioTheme } from './studio-theme';
import { fundingThermometerDefinition } from './widgets/definitions';

// Studio's default widgets stay available; the command center's own are added to them.
const withCustomWidgets = <T extends { widgets: readonly unknown[] }>(defaults: T) => ({
  ...defaults,
  widgets: [...defaults.widgets, fundingThermometerDefinition],
});

// Default export so the Money page can lazy-load it: AG Studio is a large bundle.
export default function CommandCenter() {
  const data = useMemo(() => buildStudioData(sampleCommandCenterData), []);
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
      />
    </AgStudioProvider>
  );
}
