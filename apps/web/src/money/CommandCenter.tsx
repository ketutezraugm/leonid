import { useEffect, useMemo, useState } from 'react';
import { AgStudioAiModule } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import './command-center.css';
import { useEvent } from '../shell/event';
import { Button } from '../ui/Button';
import { commandCenterReport } from './initial-report';
import { describeSources, type SourceNote } from './sources';
import { dashboardAgentHarness } from './dashboardAgent';
import { buildStudioData, type CommandCenterData } from './studio-data';
import { leonidStudioTheme } from './studio-theme';
import { useCommandCenterData } from './use-command-center-data';
import { reportState, startFrom } from './widgets/filters-changed';
import {
  budgetBurnDefinition,
  deliveryRiskDefinition,
  fundingThermometerDefinition,
  rulesHealthDefinition,
} from './widgets/definitions';

const AI_MODULES = [AgStudioAiModule];
// The AI Assistant panel exists only in Studio's edit mode, so asking the agent switches to edit mode with just the
// assistant (left) and the filters (right); closing it returns to the read-only view.
const AGENT_PANELS = { edit: { left: ['ai' as const], right: ['filters' as const] } };

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
  // F21: the dashboard agent's panel, opened on request.
  const [agentOpen, setAgentOpen] = useState(false);
  // Studio reports changes to the filters, not what they start as, and each visit to this page starts again
  // from the default report: say so, or the first selection would be taken for the starting point.
  useEffect(() => startFrom(commandCenterReport), []);
  return (
    <>
      <div className="lx-source-row">
        <p className="lx-source" data-tone={note.tone} role="status">
          {note.text}
        </p>
        <Button variant={agentOpen ? 'secondary' : 'primary'} onClick={() => setAgentOpen((open) => !open)} aria-pressed={agentOpen}>
          {agentOpen ? 'Close the dashboard agent' : 'Ask the dashboard agent'}
        </Button>
      </div>
      {/* AgStudioAiModule turns on Studio's AI Assistant panel; dashboardAgentHarness is our agent (F21). */}
      <AgStudioProvider modules={AI_MODULES} licenseKey={import.meta.env.VITE_AG_STUDIO_LICENSE || undefined}>
        <AgStudio
          style={{ height: '75vh', width: '100%' }}
          theme={leonidStudioTheme}
          layout={{ widgetBorderEnabled: true }}
          data={data}
          widgets={withCustomWidgets}
          initialState={commandCenterReport}
          mode={agentOpen ? 'edit' : 'view'}
          ai={dashboardAgentHarness}
          panels={agentOpen ? AGENT_PANELS : undefined}
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
