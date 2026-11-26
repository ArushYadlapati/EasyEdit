import { and, count, eq, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import { assets, projects, spaceStyle, styleReference } from "@/db/schema";

// What agents need to know about a space's style beyond what the style service reads: cheap checks that never touch
// a strip of frames. No role checks: the caller has found the agent's member already.

// A reference the space still learns from: a video still in the library, a project still in the space, or a link. The
// same test the style service lists them by. Needs the reference's video and project joined on.
const isLive = (spaceId: string): SQL =>
  and(
    eq(styleReference.spaceId, spaceId),
    or(ne(styleReference.kind, "video"), isNull(assets.removedAt)),
    or(ne(styleReference.kind, "project"), and(isNull(projects.deletedAt), eq(projects.spaceId, styleReference.spaceId))),
  )!;

// How many references the space's style learns from now.
export async function liveReferenceCount(db: DB, spaceId: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(styleReference)
    .leftJoin(assets, eq(assets.id, styleReference.assetId))
    .leftJoin(projects, eq(projects.id, styleReference.projectId))
    .where(isLive(spaceId));
  return total;
}

// The addresses of every link the space's style learns from, pasted or from its channel. A link never leaves with a
// video or a project, so all of them count. save_style skips a link already here before it asks the link's site.
export async function linkAddresses(db: DB, spaceId: string): Promise<string[]> {
  const rows = await db
    .select({ url: styleReference.url })
    .from(styleReference)
    .where(and(eq(styleReference.spaceId, spaceId), isNotNull(styleReference.url)));
  return rows.flatMap((row) => (row.url === null ? [] : [row.url]));
}

// Whether a space has a style worth an agent's read: a field or notes filled in, or a reference it still learns from.
// Two small reads that stop at the first row, so get_project can ask on every first page.
export async function hasStyle(db: DB, spaceId: string): Promise<boolean> {
  const [saved] = await db
    .select({ spaceId: spaceStyle.spaceId })
    .from(spaceStyle)
    .where(and(eq(spaceStyle.spaceId, spaceId), or(sql`${spaceStyle.profile} <> '{}'::jsonb`, ne(spaceStyle.notes, ""))))
    .limit(1);
  if (saved) return true;
  const [reference] = await db
    .select({ id: styleReference.id })
    .from(styleReference)
    .leftJoin(assets, eq(assets.id, styleReference.assetId))
    .leftJoin(projects, eq(projects.id, styleReference.projectId))
    .where(isLive(spaceId))
    .limit(1);
  return reference !== undefined;
}
