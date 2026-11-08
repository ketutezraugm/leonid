import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UIMessage } from 'ai';
import { AgentChat } from '../chat/AgentChat';
import type { EventInfo } from '../shell/event';
import { venuePickText, type VenueCandidate } from '@quartermaster/shared';
import { latestVenuePick, venueSearches } from '../chat/parts';
import { VenueDepositPanel } from './VenueDeposit';
import { VenueResults } from './VenueResults';
import './workspace.css';

// The agent workspace: the chat is the right rail, across from the app sidebar, and drives
// everything; the canvas shows what the agent found, like a search results page. The canvas never
// starts work on its own.
export function Workspace({
  idle,
  inEvent = null,
}: {
  idle?: ReactNode;
  inEvent?: (Pick<EventInfo, 'id' | 'name' | 'brief'> & Partial<Pick<EventInfo, 'currency' | 'maxSpend'>>) | null;
}) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const searches = useMemo(() => venueSearches(messages), [messages]);
  const picked = useMemo(() => latestVenuePick(messages), [messages]);
  // The chat's send while it is idle; picking a venue goes through the chat like any answer.
  const [send, setSend] = useState<((text: string) => void) | null>(null);
  const onSendChange = useCallback(
    (next: ((text: string) => void) | null) => setSend(() => next),
    [],
  );

  // Follow the newest search when one starts; an older one stays open only if the user picked it.
  const newestId = searches.at(-1)?.id ?? null;
  const lastNewest = useRef(newestId);
  useEffect(() => {
    if (newestId !== lastNewest.current) setViewingId(null);
    lastNewest.current = newestId;
  }, [newestId]);

  const viewing = searches.find((s) => s.id === viewingId) ?? searches.at(-1) ?? null;
  const onMessagesChange = useCallback((next: UIMessage[]) => setMessages(next), []);
  // Only the newest search can be picked from: an older one is history.
  const choose =
    send && viewing && viewing.id === newestId && viewing.status === 'done'
      ? (venue: VenueCandidate) =>
          send(venuePickText({ name: venue.name, sourceUrl: venue.sourceUrls[0] ?? '' }))
      : null;

  return (
    <div className="workspace">
      <div className="workspace-rail">
        <AgentChat
          variant="rail"
          onMessagesChange={onMessagesChange}
          viewingSearchId={viewing?.id ?? null}
          onViewSearch={setViewingId}
          onSendChange={onSendChange}
          onThreadChange={setThreadId}
          inEvent={inEvent}
        />
      </div>
      <section className="workspace-canvas" aria-label="Results">
        {/* Shown once the chat is idle: the pick is saved on the server when its run ends. */}
        {picked && threadId && send && (
          <VenueDepositPanel
            key={`${threadId} ${picked.sourceUrl}`}
            threadId={threadId}
            pickName={picked.name}
          />
        )}
        {viewing ? (
          <VenueResults key={viewing.id} search={viewing} picked={picked} onChoose={choose} />
        ) : (
          <CanvasIdle>{idle}</CanvasIdle>
        )}
      </section>
    </div>
  );
}

function CanvasIdle({ children }: { children?: ReactNode }) {
  return (
    <div className="canvas-idle">
      <p className="canvas-idle-eyebrow">Results</p>
      <h2>What the agent finds shows up here</h2>
      <p className="muted">
        Ask in the chat. When the agent searches for venues you get every option side by
        side, with the price, the capacity and the page each fact came from, so you can sort, filter
        and compare before you decide.
      </p>
      <ol className="canvas-idle-steps">
        <li>
          <strong>Describe the event</strong>
          <span>City, headcount, date and budget, in your own words.</span>
        </li>
        <li>
          <strong>The agent researches</strong>
          <span>It searches venue listings and reads each page. You can watch each step.</span>
        </li>
        <li>
          <strong>Compare and pick</strong>
          <span>Every figure links to its source. Choose the one that fits.</span>
        </li>
        <li>
          <strong>Pay the deposit with PayPal</strong>
          <span>
            Your spending rules decide: small deposits pay at once, bigger ones need the treasurer.
          </span>
        </li>
      </ol>
      {children}
    </div>
  );
}
