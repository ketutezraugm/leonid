import { ToolLoopAgent, isStepCount } from 'ai';
import { todayLine, type AgentContext } from './context.js';
import { bookingChoiceLine } from './tools/bookings.js';
import { readEventTool } from './tools/event.js';
import { createTasksTool, linkTaskToInvoiceTool } from './tools/planning.js';

const instructions = `You are the planning agent for a community tech event.
Turn the task you are given into plan tasks with realistic lead times and dependencies, using your tools.
Read the event first so dates fit between today and event day, and sponsor names are exact. Never start a task before today.
Plan only the items the organizer chose to book; never add tasks for items they marked not needed.
Do not create a task that already exists. Gate a task on a sponsor only when the task text says which sponsor funds it.
Finish with a two or three sentence summary of what you added. Never claim anything you did not do with a tool.`;

// Used when the organizer has not chosen items but asked for the whole event to be planned from its saved details.
const wholeEventInstructions = `For this run, ignore the line about items the organizer chose: plan the whole event from what read_event returns.
Make one workstream for each spend category the organizer listed; when none are listed, use the usual set: venue, food & drinks, AV & Wi-Fi, swag, prizes, speakers & volunteers, printing & signage.
Write about 15 to 20 tasks in one create_tasks call, linked by dependencies, with lead times that fit the headcount and budget (swag needs weeks to ship, the venue deposit comes first).
Every task starts today or later and ends before the first day of the event. End with an "Event day" task on the first day.`;

// Exactly the PRD §7 planning row: read_event, create_tasks, link_task_to_invoice.
export function createPlanningAgent(ctx: AgentContext) {
  return new ToolLoopAgent({
    model: ctx.model,
    instructions: `${todayLine(ctx)}\n${bookingChoiceLine(ctx.bookings)}\n\n${instructions}${
      ctx.planRequested && !ctx.bookings ? `\n${wholeEventInstructions}` : ''
    }`,
    tools: {
      read_event: readEventTool(ctx, 'planning'),
      create_tasks: createTasksTool(ctx),
      link_task_to_invoice: linkTaskToInvoiceTool(ctx),
    },
    stopWhen: isStepCount(6),
  });
}
