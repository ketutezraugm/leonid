import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import {
  ApiError,
  CHAT_MESSAGE_MAX_LENGTH,
  ChatThreadListResponse,
  ChatThreadResponse,
  EVENT_PLAN_REQUEST,
  type ChatEventRef,
  type ChatThreadSummary,
  type ChecklistItem,
} from '@quartermaster/shared';
import { AskUserCard } from './AskUserCard';
import { BookingsCard } from './BookingsCard';
import { Checklist } from './Checklist';
import {
  askUserInput,
  chooseBookingsInput,
  createdEvent,
  isToolPart,
  latestChecklist,
  latestVenuePick,
  readableError,
  stepOf,
  venueSearchOf,
  type VenueSearch,
} from './parts';
import { useEvents } from '../shell/event';
import { loadActiveId, loadIds, newThreadId, saveActiveId, saveIds, withId } from './sessions';
import { ThreadList } from './ThreadList';
import './chat.css';

// Written for first-time organizers: full sentences with the details the agent needs. The cities are
// ones the seeded demo venue listings cover (Indonesia, Malaysia, Singapore), so every example finds
// real results, and each venue lists a deposit the organizer can pay with PayPal after picking it.
const suggestions = [
  {
    title: 'Plan a hackathon in Jakarta',
    prompt:
      'I want to run a hackathon in West Jakarta for 150 people on Saturday, 21 November 2026, ' +
      'from 9 am to 9 pm. My budget is $8,000. Find a venue first, then help me plan the rest.',
  },
  {
    title: 'Find a venue in Kuala Lumpur',
    prompt:
      'Find venues in Kuala Lumpur for a 60-person workshop on Saturday, 5 December 2026, ' +
      'ideally with catering included. Show the price, the capacity and the deposit to hold the date.',
  },
  {
    title: 'Book a meetup space in Singapore',
    prompt:
      'Find a coworking space or rooftop in Singapore for an evening meetup of 80 people on ' +
      'Friday, 13 November 2026. Once I pick one, I want to pay the deposit with PayPal.',
  },
  {
    title: 'Check my event',
    prompt:
      'Give me a quick summary of my event: the date, how many people, the sponsors, ' +
      'and what is still left to do.',
  },
];

interface CanvasLink {
  // The canvas this chat drives, when it is the workspace rail: it receives the messages and
  // opens a venue search when the user picks one in the chat.
  onMessagesChange?: (messages: UIMessage[]) => void;
  viewingSearchId?: string | null;
  onViewSearch?: (id: string) => void;
  // Viewing a search leaves this chat. The server stops a run when its chat goes away, so the
  // link waits for the run to end.
  viewLeavesChat?: boolean;
  // Lets the canvas send a message (a venue pick) through this chat. Null while a run is going.
  onSendChange?: (send: ((text: string) => void) | null) => void;
  // The open chat's id, so the canvas can ask the server about this chat (the venue deposit).
  onThreadChange?: (threadId: string) => void;
}

export function AgentChat({
  variant = 'panel',
  onMessagesChange,
  viewingSearchId = null,
  onViewSearch,
  viewLeavesChat = false,
  onSendChange,
  onThreadChange,
  eventScope = null,
  currentEvent = null,
  autoPlan = false,
}: {
  variant?: 'panel' | 'rail';
  // The /events/:eventId the screen is on (the route id), or null outside an event. Each event keeps its own open chat.
  // Passed in because this component renders without a router in tests and in the workspace.
  eventScope?: string | null;
  // That event, when it is one of the person's own (not the demo): a new chat is linked to it. The demo event stays
  // unlinked, because the demo's example prompts have the agent create an event of its own.
  currentEvent?: ChatEventRef | null;
  // Send the plan kickoff once when this event's chat is empty (right after New event).
  autoPlan?: boolean;
} & CanvasLink = {}) {
  const [threadId, setThreadId] = useState(() => loadActiveId(eventScope));
  const [ids, setIds] = useState(() => withId(loadIds(), threadId));
  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
  const [demoEvent, setDemoEvent] = useState<ChatEventRef | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<ChatThreadSummary | null>(null);
  const [showList, setShowList] = useState(false);
  const [loaded, setLoaded] = useState<{
    threadId: string;
    thread: ChatThreadResponse;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/chat/${threadId}`)
      .then(async (res) => {
        if (!res.ok) {
          const apiError = ApiError.safeParse(await res.json().catch(() => null));
          throw new Error(apiError.success ? apiError.data.error : `HTTP ${res.status}`);
        }
        return ChatThreadResponse.parse(await res.json());
      })
      .then((thread) => !cancelled && setLoaded({ threadId, thread, error: null }))
      .catch((err: unknown) => {
        if (cancelled) return;
        // Still usable: start from an empty thread and surface why history is missing.
        setLoaded({
          threadId,
          thread: { messages: [], checklist: [], event: null },
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const ready = loaded?.threadId === threadId ? loaded : null;

  // A different chat is loading: clear the canvas instead of showing the last chat's results.
  useEffect(() => {
    onMessagesChange?.([]);
  }, [threadId, onMessagesChange]);
  useEffect(() => {
    onThreadChange?.(threadId);
  }, [threadId, onThreadChange]);

  // Ask the server which of this browser's chats exist; ones it does not return (archived, never
  // messaged, gone) drop out of the local list, except the one being viewed.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/threads/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then(async (res) => (res.ok ? ChatThreadListResponse.parse(await res.json()) : null))
      .then((body) => {
        if (cancelled || !body) return;
        setThreads(body.threads);
        setDemoEvent(body.demoEvent);
        const kept = ids.filter((id) => id === threadId || body.threads.some((t) => t.id === id));
        if (kept.length !== ids.length) {
          setIds(kept);
          saveIds(kept);
        }
      })
      .catch(() => {
        // The list is a convenience; the chat itself still works.
      });
    return () => {
      cancelled = true;
    };
  }, [ids, threadId, refreshCount]);

  // In one of the person's own events the chat list shows only that event's chats; the demo and other screens show all.
  const visibleThreads = currentEvent
    ? (threads ?? []).filter((t) => t.event?.id === currentEvent.id)
    : (threads ?? []);

  const refreshThreads = useCallback(() => setRefreshCount((n) => n + 1), []);

  // Events a new chat may be linked to: the demo event and the ones this browser's chats work on.
  const eventOptions = [demoEvent, currentEvent, ...(threads ?? []).map((t) => t.event)].filter(
    (event, index, all): event is ChatEventRef =>
      !!event && all.findIndex((other) => other?.id === event.id) === index,
  );

  function open(id: string) {
    setThreadId(id);
    saveActiveId(id, eventScope);
    const next = withId(ids, id);
    setIds(next);
    saveIds(next);
    setShowList(false);
  }

  // Moving to another event opens that event's chat. It waits while a run is going and keeps the open chat when the
  // screen leaves every event, so the drawer does not jump under the person.
  const lastScope = useRef(eventScope);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    if (eventScope === lastScope.current) return;
    lastScope.current = eventScope;
    if (eventScope !== null && !busy) openRef.current(loadActiveId(eventScope));
  }, [eventScope, busy]);

  function startNew() {
    // An unsent chat is not in the list, so reuse it instead of piling up empty ones.
    if (threads && !threads.some((t) => t.id === threadId)) return setShowList(false);
    open(newThreadId());
  }

  async function patch(id: string, body: { title?: string; archived?: boolean }) {
    const res = await fetch(`/api/chat/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function rename(id: string, title: string) {
    if (await patch(id, { title })) refreshThreads();
  }

  async function archive(id: string) {
    const thread = threads?.find((t) => t.id === id);
    if (!(await patch(id, { archived: true }))) return;
    if (thread) setUndo(thread);
    if (id === threadId) {
      const next = visibleThreads.find((t) => t.id !== id);
      open(next?.id ?? newThreadId());
    } else {
      refreshThreads();
    }
  }

  // Gone for good on the server, so it also leaves this browser's list and any pending undo.
  async function remove(id: string) {
    const res = await fetch(`/api/chat/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return;
    if (undo?.id === id) setUndo(null);
    const rest = ids.filter((existing) => existing !== id);
    if (id === threadId) {
      const next = visibleThreads.find((t) => t.id !== id)?.id ?? newThreadId();
      setThreadId(next);
      saveActiveId(next, eventScope);
      setIds(withId(rest, next));
      saveIds(withId(rest, next));
      setShowList(false);
    } else {
      setIds(rest);
      saveIds(rest);
    }
  }

  async function restore() {
    if (!undo) return;
    const restored = undo;
    setUndo(null);
    if (await patch(restored.id, { archived: false })) {
      const next = withId(ids, restored.id);
      setIds(next);
      saveIds(next);
      refreshThreads();
    }
  }

  return (
    <section className={`chat chat--${variant}`} aria-label="Agent chat">
      <header className="chat-header">
        <h2>Ask Quartermaster</h2>
        <button
          type="button"
          className="chat-toggle"
          aria-expanded={showList}
          onClick={() => setShowList((open) => !open)}
        >
          Chats
        </button>
      </header>
      <div className={`chat-body${showList ? ' chat-body--list' : ''}`}>
        <div className="chat-sidebar">
          <ThreadList
            threads={visibleThreads}
            activeId={threadId}
            disabled={busy}
            onSelect={open}
            onNew={startNew}
            onRename={rename}
            onArchive={archive}
            onDelete={remove}
          />
          {undo && (
            <p className="chat-undo" role="status">
              Archived “{undo.title}”.{' '}
              <button type="button" onClick={restore}>
                Undo
              </button>
            </p>
          )}
        </div>
        <div className="chat-main">
          {ready ? (
            <ChatPanel
              key={threadId}
              threadId={threadId}
              initialMessages={ready.thread.messages as UIMessage[]}
              initialChecklist={ready.thread.checklist}
              initialEvent={ready.thread.event}
              eventOptions={eventOptions}
              currentEvent={currentEvent}
              autoPlan={autoPlan}
              loadError={ready.error}
              onBusyChange={setBusy}
              onSettled={refreshThreads}
              onMessagesChange={onMessagesChange}
              viewingSearchId={viewingSearchId}
              onViewSearch={onViewSearch}
              viewLeavesChat={viewLeavesChat}
              onSendChange={onSendChange}
            />
          ) : (
            <p className="muted chat-loading">Loading conversation…</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ChatPanel({
  threadId,
  initialMessages,
  initialChecklist,
  initialEvent,
  eventOptions,
  currentEvent,
  autoPlan = false,
  loadError,
  onBusyChange,
  onSettled,
  onMessagesChange,
  viewingSearchId,
  onViewSearch,
  viewLeavesChat = false,
  onSendChange,
}: CanvasLink & {
  threadId: string;
  initialMessages: UIMessage[];
  initialChecklist: ChecklistItem[];
  initialEvent: ChatEventRef | null;
  eventOptions: ChatEventRef[];
  currentEvent: ChatEventRef | null;
  autoPlan?: boolean;
  loadError: string | null;
  onBusyChange: (busy: boolean) => void;
  onSettled: () => void;
}) {
  const [draft, setDraft] = useState('');
  const lastSent = useRef('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // An existing event this new chat may see: the one the screen is on unless the user picks another (or none) before
  // the first message. undefined means "not picked", which follows the screen's event for an empty chat.
  const [picked, setPicked] = useState<ChatEventRef | null | undefined>(undefined);
  const { refresh: refreshEvents } = useEvents();

  const { messages, setMessages, sendMessage, status, error, clearError } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      // The server owns the history: send only the new message. The event link is only read when
      // the server creates the thread.
      prepareSendMessagesRequest: ({ id, messages, body }) => ({
        body: { ...body, threadId: id, message: messages.at(-1) },
      }),
    }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const linked = picked !== undefined ? picked : initialMessages.length === 0 ? currentEvent : null;
  const checklist = latestChecklist(messages) ?? initialChecklist;
  const started = messages.length > 0;
  const event = initialEvent ?? createdEvent(messages) ?? (started ? linked : null);
  const venuePick = latestVenuePick(messages);

  // An event the agent creates in this chat joins the person's list, so its screens open without a reload.
  const createdId = createdEvent(messages)?.id;
  const knownCreatedId = useRef(createdId);
  useEffect(() => {
    if (!createdId || createdId === knownCreatedId.current) return;
    knownCreatedId.current = createdId;
    refreshEvents();
  }, [createdId, refreshEvents]);

  // Tell the list when a run starts (lock switching) and ends (refresh title and order).
  const wasBusy = useRef(false);
  useEffect(() => {
    onBusyChange(busy);
    if (wasBusy.current && !busy) onSettled();
    wasBusy.current = busy;
  }, [busy, onBusyChange, onSettled]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, status]);

  // On failure, take the unanswered message back out and put it in the box so the user can retry.
  useEffect(() => {
    if (!error) return;
    setMessages((current) => (current.at(-1)?.role === 'user' ? current.slice(0, -1) : current));
    setDraft((current) => current || lastSent.current);
  }, [error, setMessages]);

  function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    lastSent.current = content;
    clearError();
    setDraft('');
    // Fixes the link at the first send, so moving to another event mid-chat never relabels this chat.
    setPicked(linked);
    void sendMessage({ text: content }, linked ? { body: { eventId: linked.id } } : undefined);
  }

  // Right after New event, plan the event from its saved details. Only into an empty chat, and only once even when
  // StrictMode runs the effect twice or the person reloads (the guard is the thread being empty on the server).
  const autoPlanned = useRef(false);
  useEffect(() => {
    if (!autoPlan || autoPlanned.current || !currentEvent || initialMessages.length > 0) return;
    autoPlanned.current = true;
    send(EVENT_PLAN_REQUEST);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlan, currentEvent]);

  // Hand the canvas the current send, or null while a run is going so it cannot pick mid-run.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    onSendChange?.(busy ? null : (text) => sendRef.current(text));
  }, [busy, onSendChange]);
  useEffect(() => () => onSendChange?.(null), [onSendChange]);

  // Fill the box instead of sending, so the organizer can change the city, headcount or budget first.
  function pickSuggestion(prompt: string) {
    setDraft(prompt);
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    requestAnimationFrame(() => input.setSelectionRange(prompt.length, prompt.length));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  }

  const waitingForText = busy && messages.at(-1)?.role !== 'assistant';

  return (
    <>
      {started && (
        <p className="chat-event muted">
          {event ? `Event: ${event.name}` : 'No event in this chat yet'}
        </p>
      )}
      <Checklist items={checklist} />

      <div className="chat-log" ref={logRef} role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            {currentEvent ? (
              <>
                <p className="chat-empty-title">Plan {currentEvent.name}</p>
                <p className="muted">
                  I plan this event from the details you entered: the dates, the headcount, the
                  budget and the categories. Or ask me anything about it below.
                </p>
                <button
                  type="button"
                  className="chat-plan"
                  disabled={busy}
                  onClick={() => send(EVENT_PLAN_REQUEST)}
                >
                  Plan this event
                </button>
              </>
            ) : (
              <>
                <p className="chat-empty-title">What do you want to do?</p>
                <p className="muted">
                  Tell me about your event in your own words: the city, how many people, the date
                  and your budget. Or pick an example, change the details, then press Send.
                </p>
              </>
            )}
            {!currentEvent && eventOptions.length > 0 && (
              <label className="chat-event-pick">
                Event for this chat
                <select
                  value={linked?.id ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    setPicked(eventOptions.find((option) => option.id === e.target.value) ?? null)
                  }
                >
                  <option value="">None, start fresh</option>
                  {eventOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!currentEvent && (
              <div className="chat-suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.title}
                    type="button"
                    disabled={busy}
                    onClick={() => pickSuggestion(suggestion.prompt)}
                  >
                    <strong>{suggestion.title}</strong>
                    <span>{suggestion.prompt}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((message, index) => (
            <Message
              key={message.id}
              message={message}
              // Only the newest message's questions can still be answered.
              answerable={!busy && index === messages.length - 1}
              onAnswer={send}
              viewingSearchId={viewingSearchId}
              onViewSearch={onViewSearch}
              viewLocked={viewLeavesChat && busy}
              pickedVenue={venuePick?.name ?? null}
            />
          ))
        )}
        {waitingForText && (
          <div className="chat-message chat-message--assistant chat-message--pending">
            Thinking…
          </div>
        )}
      </div>

      {(error || loadError) && (
        <p className="chat-error" role="alert">
          {error ? readableError(error) : `Could not load earlier messages: ${loadError}`}
        </p>
      )}

      <form className="chat-form" onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          aria-label="Message"
          placeholder="e.g. Find a venue in Bandung for 100 people, budget $3,000 (Enter to send)"
          rows={2}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </>
  );
}

function Message({
  message,
  answerable,
  onAnswer,
  viewingSearchId,
  onViewSearch,
  viewLocked,
  pickedVenue,
}: Pick<CanvasLink, 'viewingSearchId' | 'onViewSearch'> & {
  message: UIMessage;
  viewLocked: boolean;
  pickedVenue: string | null;
  answerable: boolean;
  onAnswer: (text: string) => void;
}) {
  const speaker = message.role === 'user' ? 'You: ' : 'Quartermaster: ';
  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          if (!part.text.trim()) return null;
          return (
            <div key={index} className={`chat-message chat-message--${message.role}`}>
              <span className="visually-hidden">{speaker}</span>
              {part.text}
            </div>
          );
        }
        if (isToolPart(part)) {
          const questions = askUserInput(part);
          if (questions) {
            return (
              <AskUserCard
                key={part.toolCallId}
                input={questions}
                active={answerable}
                onAnswer={onAnswer}
              />
            );
          }
          const bookings = chooseBookingsInput(part);
          if (bookings) {
            return (
              <BookingsCard
                key={part.toolCallId}
                input={bookings}
                active={answerable}
                onAnswer={onAnswer}
              />
            );
          }
          const search = onViewSearch ? venueSearchOf(part) : null;
          if (search && onViewSearch) {
            return (
              <VenueSearchCard
                key={search.id}
                search={search}
                viewing={search.id === viewingSearchId}
                locked={viewLocked}
                picked={search.candidates.find((c) => c.name === pickedVenue)?.name ?? null}
                onView={() => onViewSearch(search.id)}
              />
            );
          }
          const step = stepOf(part);
          if (!step) return null;
          return (
            <div key={step.id} className={`chat-step chat-step--${step.status}`}>
              {step.label}
              {step.status === 'running' && '…'}
              {step.status === 'failed' && ' (failed)'}
              {step.activity.length > 0 && (
                <ul className="chat-activity">
                  {step.activity.map((a) => (
                    <li key={a.id} className={`chat-activity--${a.status}`}>
                      {a.label}
                      {a.status === 'running' && '…'}
                      {a.status === 'failed' && ' (failed)'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

// A venue search in the rail: the results themselves are on the canvas, this card opens them.
function VenueSearchCard({
  search,
  viewing,
  locked,
  picked,
  onView,
}: {
  search: VenueSearch;
  viewing: boolean;
  locked: boolean;
  picked: string | null;
  onView: () => void;
}) {
  const latest = search.activity.at(-1);
  const found = search.candidates.length;
  const detail =
    search.status === 'running'
      ? (latest?.label ?? 'Starting the venue scout') + '…'
      : search.status === 'failed'
        ? 'The search failed'
        : picked
          ? `Chosen: ${picked}`
          : found > 0
            ? `${found} ${found === 1 ? 'venue' : 'venues'} found · pick one to continue`
            : 'No venues found';
  return (
    <div className={`chat-search chat-search--${search.status}${viewing ? ' is-viewing' : ''}`}>
      <div className="chat-search-text">
        <strong>Venues{search.city ? ` in ${search.city}` : ''}</strong>
        <span className="muted">
          {search.headcount !== null && `${search.headcount} people · `}
          {detail}
        </span>
      </div>
      {viewing ? (
        <span className="chat-search-badge">Viewing</span>
      ) : locked ? (
        <span className="chat-search-badge">Working…</span>
      ) : (
        <button type="button" onClick={onView}>
          View results
        </button>
      )}
    </div>
  );
}
