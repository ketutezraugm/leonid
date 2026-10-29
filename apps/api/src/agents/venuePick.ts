import type { UIMessage } from 'ai';
import { VenueCandidate, parseVenuePick, type VenuePick } from '@quartermaster/shared';

export const VENUE_SCOUT_TOOL = 'delegate_to_venue_scout';

// Venue candidates a finished scout run returned, read from its tool output.
export function scoutCandidates(output: unknown): VenueCandidate[] {
  const parsed = VenueCandidate.array().safeParse(
    (output as { candidates?: unknown } | null | undefined)?.candidates,
  );
  return parsed.success ? parsed.data : [];
}

// The organizer's latest venue pick in this conversation. Only their own messages count, and only
// a venue the scout actually returned earlier in the thread, so a typed-in name is not a pick.
export function venuePickOf(messages: readonly UIMessage[]): VenuePick | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m];
    if (message?.role !== 'user') continue;
    for (const part of message.parts) {
      if (part.type !== 'text') continue;
      const pick = parseVenuePick(part.text);
      if (pick && wasReturned(messages.slice(0, m), pick)) return pick;
    }
  }
  return null;
}

function wasReturned(messages: readonly UIMessage[], pick: VenuePick): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.parts.some(
        (part) =>
          part.type === `tool-${VENUE_SCOUT_TOOL}` &&
          'output' in part &&
          scoutCandidates(part.output).some(
            (c) => c.name === pick.name && c.sourceUrls.includes(pick.sourceUrl),
          ),
      ),
  );
}

// One line for the orchestrator's instructions. The venue name came from a web page, so it stays
// in the organizer's message and is never put into instructions.
export function venuePickLine(pick: VenuePick | null | undefined): string {
  return pick
    ? 'The organizer picked a venue from the scout results (see their "Venue chosen:" message). ' +
        'The venue is decided: do not search for venues again unless they ask.'
    : 'The organizer has not picked a venue yet.';
}
