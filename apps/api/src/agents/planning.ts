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

// Exactly the PRD §7 planning row: read_event, create_tasks, link_task_to_invoice.
export function createPlanningAgent(ctx: AgentContext) {
  return new ToolLoopAgent({
    model: ctx.model,
    instructions: `${todayLine(ctx)}\n${bookingChoiceLine(ctx.bookings)}\n\n${instructions}`,
    tools: {
      read_event: readEventTool(ctx, 'planning'),
      create_tasks: createTasksTool(ctx),
      link_task_to_invoice: linkTaskToInvoiceTool(ctx),
    },
    stopWhen: isStepCount(6),
  });
}
