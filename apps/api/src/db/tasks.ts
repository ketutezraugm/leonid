import { and, asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { sponsors, tasks } from './schema.js';

export interface NewTask {
  name: string;
  start: Date;
  end: Date;
  deadline?: Date | null;
  // Names of tasks this one depends on; they must already exist or appear earlier in the batch.
  dependsOnNames?: string[];
}

export function listTasks(db: Db, eventId: string) {
  return db.select().from(tasks).where(eq(tasks.eventId, eventId)).orderBy(asc(tasks.start));
}

export async function createTasks(db: Db, eventId: string, input: NewTask[]) {
  const idByName = new Map((await listTasks(db, eventId)).map((t) => [t.name, t.id]));
  const created = [];
  for (const task of input) {
    const dependsOn = (task.dependsOnNames ?? []).map((name) => {
      const id = idByName.get(name);
      if (!id) throw new Error(`Unknown dependency "${name}" for task "${task.name}"`);
      return id;
    });
    const [row] = await db
      .insert(tasks)
      .values({
        eventId,
        name: task.name,
        start: task.start,
        end: task.end,
        deadline: task.deadline ?? null,
        dependsOn,
      })
      .returning();
    if (!row) throw new Error(`Could not create task "${task.name}"`);
    idByName.set(row.name, row.id);
    created.push(row);
  }
  return created;
}

// Gate a task on a sponsor's invoice: the task is funded by that sponsor (PRD §8, Bryntum plan rules).
export async function linkTaskToSponsor(
  db: Db,
  eventId: string,
  taskName: string,
  sponsorName: string,
) {
  const [sponsor] = await db
    .select()
    .from(sponsors)
    .where(and(eq(sponsors.eventId, eventId), eq(sponsors.name, sponsorName)));
  if (!sponsor) throw new Error(`Unknown sponsor "${sponsorName}"`);
  const [task] = await db
    .update(tasks)
    .set({ fundedBySponsorId: sponsor.id })
    .where(and(eq(tasks.eventId, eventId), eq(tasks.name, taskName)))
    .returning();
  if (!task) throw new Error(`Unknown task "${taskName}"`);
  return { task, sponsor };
}
