import "server-only";
import { sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { PERSONAL_ALIAS, personalSpaceId } from "@/lib/spaces/types";

// A project's name for the editor's browser tab, in one small query: only for a member of the space the address names,
// and never for a deleted project (null then, and the tab keeps the plain title).
export async function projectNameFor(db: DB, userId: string, slug: string, projectId: string): Promise<string | null> {
  const wanted = slug === PERSONAL_ALIAS ? personalSpaceId(userId) : slug;
  const result = await db.execute(sql`
    select p.name
    from projects p
    join organization o on o.id = p.space_id
    join member m on m.organization_id = o.id and m.user_id = ${userId}
    where o.slug = ${wanted} and p.id = ${projectId} and p.deleted_at is null
    limit 1
  `);
  return rowsOf<{ name: string }>(result)[0]?.name ?? null;
}
