import { sql, type SQL } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import type { Limits } from "@/lib/limits";
import { agentActorIdsOf, parseAgentActor } from "@/lib/projects/display-actor";

// Each member has one allowance shared by all their AI agents, counted from what the database already holds, so
// connecting more agents does not raise it. The checks read and the write follows, so two calls at the same instant
// can both pass. That is accepted.
export type Budget = { ok: true } | { ok: false; message: string };

const OK: Budget = { ok: true };

const tooManyChanges = (count: number, limit: number) =>
  `Too many changes at once: ${count} in the last minute (the limit is ${limit}). Wait a minute, then continue.`;

const DAY_USED_UP =
  "Today's allowance for changes made through your AI agents is used up. It frees up over the next 24 hours. Editing in the app still works.";

const tooManyProjects = (limit: number) =>
  `Your AI agents have created ${limit} projects for you in the last day, which is the limit. Use an existing project, or create one in the app.`;

// The actor ids that share this actor's allowance, as a SQL list: every agent of the same member. An id that is no
// agent's stands alone. The list is exact, so no id can widen it the way a LIKE pattern could.
function sharedActors(actorId: string): SQL {
  const agent = parseAgentActor(actorId);
  const ids = agent === null ? [actorId] : agentActorIdsOf(agent.userId);
  return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

// Changes this member's agents logged in the last minute, and bytes of change data they stored in the last day.
// One query.
export async function checkWriteBudget(
  db: DB,
  actorId: string,
  limits: Pick<Limits, "connectorWritesPerMinute" | "connectorBytesPerDay">,
): Promise<Budget> {
  const [usage] = rowsOf<{ minute: number | string; bytes: number | string }>(
    await db.execute(sql`
      select
        count(*) filter (where created_at > now() - interval '1 minute') as minute,
        coalesce(sum(pg_column_size(ops) + coalesce(pg_column_size(inverse), 0)), 0) as bytes
      from project_ops
      where actor in (${sharedActors(actorId)}) and created_at > now() - interval '1 day'
    `),
  );
  const minute = Number(usage.minute);
  if (minute >= limits.connectorWritesPerMinute) return { ok: false, message: tooManyChanges(minute, limits.connectorWritesPerMinute) };
  if (Number(usage.bytes) >= limits.connectorBytesPerDay) return { ok: false, message: DAY_USED_UP };
  return OK;
}

// Projects this member's agents created in the last day (deleted ones count). One query.
export async function checkProjectBudget(db: DB, actorId: string, limits: Pick<Limits, "connectorProjectsPerDay">): Promise<Budget> {
  const [usage] = rowsOf<{ created: number | string }>(
    await db.execute(sql`
      select count(*) as created
      from projects
      where created_by in (${sharedActors(actorId)}) and created_at > now() - interval '1 day'
    `),
  );
  if (Number(usage.created) >= limits.connectorProjectsPerDay) return { ok: false, message: tooManyProjects(limits.connectorProjectsPerDay) };
  return OK;
}
