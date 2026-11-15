import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { projectOpens, projects } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";

// Notes that this person opened the project now, for their Recent list. One statement: a project that is unknown or
// deleted matches no row, so nothing is written and nothing fails.
export async function recordOpen(db: DB, actor: Actor, projectId: string): Promise<void> {
  requireRole(actor, "viewer");
  await db.execute(sql`
    insert into project_opens (user_id, project_id, opened_at)
    select ${actor.userId}::text, id, now()
    from projects
    where id = ${projectId}::text and space_id = ${actor.spaceId}::text and deleted_at is null
    on conflict (user_id, project_id) do update set opened_at = excluded.opened_at
  `);
}

// The live projects this person opened, the most recent first.
export async function listRecentProjectIds(
  db: DB,
  actor: Actor,
  limit: number = LIMITS.dashboardRecent,
): Promise<string[]> {
  requireRole(actor, "viewer");
  const rows = await db
    .select({ id: projectOpens.projectId })
    .from(projectOpens)
    .innerJoin(projects, and(eq(projects.id, projectOpens.projectId), isNull(projects.deletedAt)))
    .where(and(eq(projectOpens.userId, actor.userId), eq(projects.spaceId, actor.spaceId)))
    .orderBy(desc(projectOpens.openedAt), asc(projectOpens.projectId))
    .limit(limit);
  return rows.map((row) => row.id);
}
