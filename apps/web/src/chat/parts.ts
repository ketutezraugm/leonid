import type { UIMessage } from 'ai';
import { ChatEventRef, ChecklistItem } from '@quartermaster/shared';

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
  if (name === CHECKLIST_TOOL) return null;
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
