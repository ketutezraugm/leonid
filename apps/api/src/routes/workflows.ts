import { Render } from '@renderinc/sdk';
import { Router, type Request, type Response } from 'express';
import { requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { writeAudit } from '../db/audit.js';
import { getDb, type Db } from '../db/client.js';

// The tasks the Workflow service (apps/workflows) registers, by the name a person triggers them with.
export const WORKFLOW_TASKS = {
  'budget-recompute': 'budget-recompute',
  'invoice-reminders': 'invoice-reminders',
  'sponsor-reports': 'sponsor-reports',
} as const;

// The two calls of the Render SDK that this route uses, so a test can stand in for Render.
export interface WorkflowRunner {
  start(task: string): Promise<{ runId: string }>;
  status(runId: string): Promise<{ status: string; results: unknown; error?: string }>;
}

export interface WorkflowsRouterOptions {
  env?: NodeJS.ProcessEnv;
  runner?: () => WorkflowRunner;
  db?: () => Db;
}

// The demo controls: a treasurer starts a workflow by hand, so the video does not wait on a schedule.
//   POST /:name/run     (treasurer) starts the task in the Workflow service -> 202 { runId }
//   GET  /runs/:runId   (treasurer) -> { status, results, error? }: pending, running, succeeded, failed or canceled
//                       (Render still reports a finished run as the deprecated 'completed'; it is passed on as 'succeeded')
// Needs RENDER_API_KEY and WORKFLOW_SLUG (the Workflow service's slug, shown in the Render Dashboard); answers 503 without them.
export function workflowsRouter(options: WorkflowsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const guard = requireTreasurer(env);
  const router = Router();

  const runner = (): WorkflowRunner | undefined => {
    if (options.runner) return options.runner();
    const slug = env.WORKFLOW_SLUG;
    if (!slug || !env.RENDER_API_KEY) return undefined;
    const render = new Render({ token: env.RENDER_API_KEY });
    return {
      async start(task) {
        const started = await render.workflows.startTask(`${slug}/${task}`, []);
        return { runId: started.taskRunId };
      },
      async status(runId) {
        const run = await render.workflows.getTaskRun(runId);
        return { status: String(run.status), results: run.results, error: run.error };
      },
    };
  };

  const withRunner =
    (fn: (req: Request, res: Response, run: WorkflowRunner) => Promise<void>) => async (req: Request, res: Response) => {
      const run = runner();
      if (!run) {
        res.status(503).json({ error: 'Render Workflows are not configured on this server' });
        return;
      }
      try {
        await fn(req, res, run);
      } catch (err) {
        console.error('workflow request failed', err instanceof Error ? err.message : err);
        res.status(502).json({ error: 'Render could not complete the request' });
      }
    };

  router.post(
    '/:name/run',
    guard,
    withRunner(async (req, res, run) => {
      const name = String(req.params.name);
      if (!Object.hasOwn(WORKFLOW_TASKS, name)) {
        res.status(404).json({ error: 'No such workflow' });
        return;
      }
      const { runId } = await run.start(WORKFLOW_TASKS[name as keyof typeof WORKFLOW_TASKS]);
      try {
        await writeAudit((options.db ?? getDb)(), {
          actor: treasurerActor(res),
          action: 'workflow.trigger',
          input: { workflow: name, runId },
          reason: 'started by hand from the demo controls',
        });
      } catch (err) {
        // The run has started either way; not being able to log it must not hide the run id from the person who asked.
        console.error('workflow trigger not audited', err instanceof Error ? err.message : err);
      }
      res.status(202).json({ runId });
    }),
  );

  router.get(
    '/runs/:runId',
    guard,
    withRunner(async (req, res, run) => {
      const found = await run.status(String(req.params.runId));
      res.json({ ...found, status: found.status === 'completed' ? 'succeeded' : found.status });
    }),
  );

  return router;
}
