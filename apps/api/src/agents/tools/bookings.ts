import { tool, type UIMessage } from 'ai';
import { z } from 'zod';
import {
  BOOKING_ITEMS,
  ChooseBookingsInput,
  parseBookingChoice,
  type BookingChoice,
} from '@quartermaster/shared';
import { auditedExecute, type AgentContext } from '../context.js';

export const CHOOSE_BOOKINGS_TOOL = 'choose_bookings';

const Input = ChooseBookingsInput.extend({
  reason: z.string().max(300).optional().describe('One sentence: why you suggest these'),
});

// Shows the organizer the fixed list of things an event usually pays for, as a checklist. The run
// stops after this call (see the orchestrator's stopWhen); the choice arrives as the next message.
export function chooseBookingsTool(ctx: AgentContext) {
  return tool({
    description:
      'Show the organizer a checklist of what to book for this event (' +
      BOOKING_ITEMS.map((item) => item.id).join(', ') +
      ') so they choose before any planning. Pre-tick the items that usually fit this kind of ' +
      'event in suggested. Your turn ends after this call; their choice is the next message.',
    inputSchema: Input,
    execute: auditedExecute(ctx, 'orchestrator', CHOOSE_BOOKINGS_TOOL, async ({ suggested }) => ({
      shown: BOOKING_ITEMS.length,
      suggested,
    })),
  });
}

// The organizer's latest booking choice in this conversation, read from their own messages.
// Only user messages count, so neither the agent nor a tool result can make the choice for them.
export function bookingChoiceOf(messages: readonly UIMessage[]): BookingChoice | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m];
    if (message?.role !== 'user') continue;
    for (const part of message.parts) {
      if (part.type !== 'text') continue;
      const choice = parseBookingChoice(part.text);
      if (choice) return choice;
    }
  }
  return null;
}

// One line for the agents' instructions, so the choice survives the model's message window.
export function bookingChoiceLine(choice: BookingChoice | null | undefined): string {
  if (!choice) {
    return 'The organizer has not chosen what to book yet.';
  }
  const label = (ids: readonly string[]) =>
    BOOKING_ITEMS.filter((item) => ids.includes(item.id))
      .map((item) => `${item.label} (${item.id})`)
      .join(', ') || 'none';
  const skipped = BOOKING_ITEMS.filter((item) => !choice.chosen.includes(item.id)).map((i) => i.id);
  // Free text stays in the chat message the model already sees; it is never put into instructions.
  return (
    `The organizer chose to book: ${label(choice.chosen)}. Not needed: ${label(skipped)}.` +
    (choice.extra ? ' They also named other items in their own words; see their message.' : '')
  );
}
