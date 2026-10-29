import type { UIMessage } from 'ai';
import {
  AskUserInput,
  ChatEventRef,
  ChecklistItem,
  ChooseBookingsInput,
  VenueCandidate,
  parseVenuePick,
  type VenuePick,
} from '@quartermaster/shared';

// Tool parts arrive as `tool-<name>` with a state; these helpers read just what the UI shows.
interface ToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  // Set while a streaming tool is still working: the output is progress, not the final result.
  preliminary?: boolean;
}

export function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith('tool-');
}

export const CHECKLIST_TOOL = 'update_checklist';
export const ASK_USER_TOOL = 'ask_user';
export const CHOOSE_BOOKINGS_TOOL = 'choose_bookings';

// The agent's clarifying questions, once the tool input has fully arrived and is valid.
export function askUserInput(part: ToolPart): AskUserInput | null {
  if (part.type !== `tool-${ASK_USER_TOOL}` || part.state === 'input-streaming') return null;
  const parsed = AskUserInput.safeParse(part.input);
  return parsed.success ? parsed.data : null;
}

// The booking checklist the agent showed, with its suggested items, once the input is complete.
export function chooseBookingsInput(part: ToolPart): ChooseBookingsInput | null {
  if (part.type !== `tool-${CHOOSE_BOOKINGS_TOOL}` || part.state === 'input-streaming') return null;
  const parsed = ChooseBookingsInput.safeParse(part.input);
  return parsed.success ? parsed.data : null;
}

// The newest checklist the agent wrote in this conversation, read from the tool input
// (available while the call streams) or its output once saved.
export function latestChecklist(messages: UIMessage[]): ChecklistItem[] | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const parts = messages[m]?.parts ?? [];
    for (let p = parts.length - 1; p >= 0; p--) {
      const part = parts[p];
      if (!part || !isToolPart(part) || part.type !== `tool-${CHECKLIST_TOOL}`) continue;
      const payload = (part.output ?? part.input) as { items?: unknown } | undefined;
      const items = ChecklistItem.array().safeParse(payload?.items);
      if (items.success) return items.data;
    }
  }
  return null;
}

// The event the agent created in this conversation, once create_event has finished.
export function createdEvent(messages: UIMessage[]): ChatEventRef | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolPart(part) || part.type !== 'tool-create_event') continue;
      const event = ChatEventRef.safeParse((part.output as { event?: unknown } | undefined)?.event);
      if (event.success) return event.data;
    }
  }
  return null;
}

const stepLabels: Record<string, string> = {
  read_event: 'Reading the event',
  create_event: 'Creating the event',
  delegate_to_planning: 'Planning agent',
  delegate_to_venue_scout: 'Searching for venues',
};

export interface Step {
  id: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  // What a delegated agent is doing right now (searches, pages read), streamed by the server.
  activity: { id: string; label: string; status: 'running' | 'done' | 'failed' }[];
}

function readActivity(output: unknown): Step['activity'] {
  const raw = (output as { activity?: unknown } | undefined)?.activity;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is Step['activity'][number] =>
      typeof a?.id === 'string' && typeof a.label === 'string' && typeof a.status === 'string',
  );
}

export function stepOf(part: ToolPart): Step | null {
  const name = part.type.slice('tool-'.length);
  if (name === CHECKLIST_TOOL || name === ASK_USER_TOOL || name === CHOOSE_BOOKINGS_TOOL)
    return null;
  return {
    id: part.toolCallId,
    label: stepLabels[name] ?? name.replaceAll('_', ' '),
    activity: readActivity(part.output),
    status:
      part.state === 'output-available' && !part.preliminary
        ? 'done'
        : part.state === 'output-error'
          ? 'failed'
          : 'running',
  };
}

export const VENUE_SCOUT_TOOL = 'delegate_to_venue_scout';

// One venue scout run, as the results canvas shows it. Candidates arrive with the final output;
// while the scout works, only its activity is filled in.
export interface VenueSearch {
  id: string;
  city: string;
  headcount: number | null;
  notes: string | null;
  status: Step['status'];
  activity: Step['activity'];
  candidates: VenueCandidate[];
  summary: string | null;
}

export function venueSearchOf(part: ToolPart): VenueSearch | null {
  if (part.type !== `tool-${VENUE_SCOUT_TOOL}`) return null;
  const step = stepOf(part);
  if (!step) return null;
  // The input is model output and may still be streaming, so every field is read defensively.
  const input = (part.input ?? {}) as Record<string, unknown>;
  const output = (part.output ?? {}) as { candidates?: unknown; summary?: unknown };
  const candidates = VenueCandidate.array().safeParse(output.candidates);
  return {
    id: part.toolCallId,
    city: typeof input.city === 'string' ? input.city : '',
    headcount: typeof input.headcount === 'number' ? input.headcount : null,
    notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes : null,
    status: step.status,
    activity: step.activity,
    candidates: candidates.success ? candidates.data : [],
    summary: typeof output.summary === 'string' ? output.summary : null,
  };
}

// Every venue search in the conversation, oldest first.
export function venueSearches(messages: UIMessage[]): VenueSearch[] {
  const searches: VenueSearch[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolPart(part)) continue;
      const search = venueSearchOf(part);
      if (search) searches.push(search);
    }
  }
  return searches;
}

// The organizer's latest venue pick, from their own messages. The server checks it against the
// scout's results; here it only marks the chosen card.
export function latestVenuePick(messages: UIMessage[]): VenuePick | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m];
    if (message?.role !== 'user') continue;
    for (const part of message.parts) {
      if (part.type !== 'text') continue;
      const pick = parseVenuePick(part.text);
      if (pick) return pick;
    }
  }
  return null;
}

// The server answers failures with {"error": "..."}; the transport puts that body in the message.
export function readableError(error: Error): string {
  try {
    const body: unknown = JSON.parse(error.message);
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
  } catch {
    // Not JSON: a network failure or a stream error message.
  }
  return error.message || 'The agent is unavailable.';
}
