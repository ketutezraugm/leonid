import { EventWizard } from '../setup/EventWizard';
import { Events } from './Events';

// Event setup (UX plan 1, screen 2): a popup over All events. Pick the kind of event, answer a short
// interview, and the agent starts on it. The treasury and the agent wallet are shared by every
// event, so they live in Settings. The list behind is inert: the popup is the only thing to use.
export function NewEvent() {
  return (
    <>
      <div inert aria-hidden="true">
        <Events />
      </div>
      <EventWizard />
    </>
  );
}
