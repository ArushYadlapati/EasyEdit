import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { projectPins, projects } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { ServiceError } from "@/lib/service-error";

// The space's pinned projects, for its sidebar. A pin belongs to the space: everyone in it sees the same list, and
// editors change it.

const projectGone = (projectId: string) => new ServiceError("NOT_FOUND", 404, `Project "${projectId}" not found`);

const liveInSpace = (actor: Actor, projectId: string) =>
  and(eq(projects.id, projectId), eq(projects.spaceId, actor.spaceId), isNull(projects.deletedAt));

async function requireLiveProject(db: DB, actor: Actor, projectId: string): Promise<void> {
  const rows = await db.select({ id: projects.id }).from(projects).where(liveInSpace(actor, projectId));
  if (!rows[0]) throw projectGone(projectId);
}

// The live projects pinned in the actor's space, the oldest pin first.
export async function listPinnedIds(db: DB, actor: Actor): Promise<string[]> {
  requireRole(actor, "viewer");
  const rows = await db
    .select({ id: projectPins.projectId })
    .from(projectPins)
    .innerJoin(projects, and(eq(projects.id, projectPins.projectId), isNull(projects.deletedAt)))
    .where(and(eq(projectPins.spaceId, actor.spaceId), eq(projects.spaceId, actor.spaceId)))
    .orderBy(asc(projectPins.pinnedAt), asc(projectPins.projectId));
  return rows.map((row) => row.id);
}

// Pins a live project of the space. One statement, so a project deleted meanwhile matches no row; pinning a pinned
// project changes nothing and keeps its place.
export async function pinProject(db: DB, actor: Actor, projectId: string): Promise<void> {
  requireRole(actor, "editor");
  await db.execute(sql`
    insert into project_pins (project_id, space_id, pinned_by, pinned_at)
    select id, space_id, ${actor.userId}::text, now()
    from projects
    where id = ${projectId}::text and space_id = ${actor.spaceId}::text and deleted_at is null
    on conflict (project_id) do nothing
  `);
  await requireLiveProject(db, actor, projectId);
}

// Unpins a live project of the space; unpinning one that is not pinned changes nothing.
export async function unpinProject(db: DB, actor: Actor, projectId: string): Promise<void> {
  requireRole(actor, "editor");
  await requireLiveProject(db, actor, projectId);
  await db.delete(projectPins).where(and(eq(projectPins.projectId, projectId), eq(projectPins.spaceId, actor.spaceId)));
}
