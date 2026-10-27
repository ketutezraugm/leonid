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
  type ChatEventRef,
  type ChatThreadSummary,
  type ChecklistItem,
} from '@quartermaster/shared';
import { Checklist } from './Checklist';
import { createdEvent, isToolPart, latestChecklist, readableError, stepOf } from './parts';
import { loadActiveId, loadIds, newThreadId, saveActiveId, saveIds, withId } from './sessions';
import { ThreadList } from './ThreadList';
import './chat.css';

// Written for first-time organizers: full sentences with the details the agent needs. Each one only
// asks for what the agent can do today (read the event, plan tasks, scout venues).
const suggestions = [
  {
    title: 'Plan a new event',
    prompt:
      'I want to run a tech meetup in Jakarta for 30 people on a Saturday afternoon. ' +
      'My budget is about $2,000. What do I need to prepare, and in what order?',
  },
  {
    title: 'Find a venue',
    prompt:
      'Find 3 venues in Jakarta that fit 30 people for a half-day workshop. ' +
      'Show the price, the capacity and where you found each one.',
  },
  {
    title: 'Check my event',
    prompt:
      'Give me a quick summary of my event: the date, how many people, the sponsors, ' +
      'and what is still left to do.',
  },
  {
    title: 'I am new to this',
    prompt:
      'I have never organized an event before. Explain in simple steps what you can help me with.',
  },
];

export function AgentChat() {
  const [threadId, setThreadId] = useState(loadActiveId);
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

  const refreshThreads = useCallback(() => setRefreshCount((n) => n + 1), []);

  // Events a new chat may be linked to: the demo event and the ones this browser's chats work on.
  const eventOptions = [demoEvent, ...(threads ?? []).map((t) => t.event)].filter(
    (event, index, all): event is ChatEventRef =>
      !!event && all.findIndex((other) => other?.id === event.id) === index,
  );

  function open(id: string) {
    setThreadId(id);
    saveActiveId(id);
    const next = withId(ids, id);
    setIds(next);
    saveIds(next);
    setShowList(false);
  }

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
      const next = threads?.find((t) => t.id !== id);
      open(next?.id ?? newThreadId());
    } else {
      refreshThreads();
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
    <section className="chat" aria-label="Agent chat">
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
            threads={threads ?? []}
            activeId={threadId}
            disabled={busy}
            onSelect={open}
            onNew={startNew}
            onRename={rename}
            onArchive={archive}
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
              loadError={ready.error}
              onBusyChange={setBusy}
              onSettled={refreshThreads}
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
  loadError,
  onBusyChange,
  onSettled,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  initialChecklist: ChecklistItem[];
  initialEvent: ChatEventRef | null;
  eventOptions: ChatEventRef[];
  loadError: string | null;
  onBusyChange: (busy: boolean) => void;
  onSettled: () => void;
}) {
  const [draft, setDraft] = useState('');
  const lastSent = useRef('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // An existing event this new chat may see, chosen by the user before the first message.
  const [linked, setLinked] = useState<ChatEventRef | null>(null);

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
  const checklist = latestChecklist(messages) ?? initialChecklist;
  const started = messages.length > 0;
  const event = initialEvent ?? createdEvent(messages) ?? (started ? linked : null);

  // Tell the list when a run starts (lock switching) and ends (refresh title and order).
  const wasBusy = useRef(false);
  useEffect(() => {
    onBusyChange(busy);
    if (wasBusy.current && !busy) onSettled();
    wasBusy.current = busy;
  }, [busy, onBusyChange, onSettled]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

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
    void sendMessage({ text: content }, linked ? { body: { eventId: linked.id } } : undefined);
  }

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
            <p className="chat-empty-title">What do you want to do?</p>
            <p className="muted">
              Tell me about your event in your own words: the city, how many people, the date and
              your budget. Or pick an example, change the details, then press Send.
            </p>
            {eventOptions.length > 0 && (
              <label className="chat-event-pick">
                Event for this chat
                <select
                  value={linked?.id ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    setLinked(eventOptions.find((option) => option.id === e.target.value) ?? null)
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
          </div>
        ) : (
          messages.map((message) => <Message key={message.id} message={message} />)
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
          placeholder="e.g. Plan a meetup in Jakarta for 30 people, budget $2,000 (Enter to send)"
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

function Message({ message }: { message: UIMessage }) {
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
