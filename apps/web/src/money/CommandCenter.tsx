import { useEffect, useMemo } from 'react';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import './command-center.css';
import { useEvent } from '../shell/event';
import { commandCenterReport } from './initial-report';
import { describeSources, type SourceNote } from './sources';
import { buildStudioData, type CommandCenterData } from './studio-data';
import { quartermasterStudioTheme } from './studio-theme';
import { useCommandCenterData } from './use-command-center-data';
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

// Studio gets its data once, when it starts, so it is mounted only after the numbers have arrived.
function Studio({ source, note }: { source: CommandCenterData; note: SourceNote }) {
  const data = useMemo(() => buildStudioData(source), [source]);
  // Studio reports changes to the filters, not what they start as, and each visit to this page starts again
  // from the default report: say so, or the first selection would be taken for the starting point.
  useEffect(() => startFrom(commandCenterReport), []);
  return (
    <>
      <p className="qm-source" data-tone={note.tone} role="status">
        {note.text}
      </p>
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
    </>
  );
}

// Default export so the Money page can lazy-load it: AG Studio is a large bundle. The numbers come from the
// widget endpoints; if they cannot be fetched the page shows its sample, and says so above the widgets.
export default function CommandCenter() {
  const event = useEvent();
  // Keyed by the event, so switching events starts from "loading" instead of showing the last event's numbers
  // while the new ones load.
  return <EventCommandCenter key={event.id ?? event.routeId} eventId={event.id} />;
}

function EventCommandCenter({ eventId }: { eventId: string | null }) {
  const state = useCommandCenterData(eventId);
  if (state.status === 'loading') return <p className="muted">Loading the command center…</p>;
  return <Studio source={state.data} note={describeSources(state.origins, state.problem)} />;
}
