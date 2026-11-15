import { and, eq, isNull, sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { assets, folders, projects } from "@/db/schema";
import { getRole, type Role } from "@/lib/allowlist/service";
import { PERSONAL_ALIAS, SEED_TEAM_ID, personalSpaceId, type MySpace } from "./types";

type SpaceRow = { id: string; slug: string; name: string; kind: "personal" | "team"; role: Role };

const toMySpace = (r: SpaceRow): MySpace => ({ id: r.id, slug: r.slug, name: r.name, kind: r.kind, role: r.role });

// Personal first, then teams by lower(name).
export async function listMySpaces(db: DB, userId: string): Promise<MySpace[]> {
  const result = await db.execute(sql`
    select o.id, o.slug, o.name, o.kind, m.role
    from member m join organization o on o.id = m.organization_id
    where m.user_id = ${userId}
    order by (o.kind = 'personal') desc, lower(o.name), o.id
  `);
  return rowsOf<SpaceRow>(result).map(toMySpace);
}

// "personal" is the viewer's own personal space. Null when the viewer is not a member.
export async function findMySpace(db: DB, userId: string, slug: string): Promise<MySpace | null> {
  const wanted = slug === PERSONAL_ALIAS ? personalSpaceId(userId) : slug;
  const result = await db.execute(sql`
    select o.id, o.slug, o.name, o.kind, m.role
    from member m join organization o on o.id = m.organization_id
    where m.user_id = ${userId} and o.slug = ${wanted}
  `);
  const row = rowsOf<SpaceRow>(result)[0];
  return row ? toMySpace(row) : null;
}

export async function roleIn(db: DB, userId: string, spaceId: string): Promise<Role | null> {
  const result = await db.execute(sql`
    select role from member where user_id = ${userId} and organization_id = ${spaceId}
  `);
  return rowsOf<{ role: Role }>(result)[0]?.role ?? null;
}

// One statement: the organization and the member row, each skipped if it exists (fixed ids).
export async function ensurePersonalSpace(db: DB, user: { id: string }): Promise<void> {
  const id = personalSpaceId(user.id);
  await db.execute(sql`
    with org as (
      insert into organization (id, name, slug, created_at, kind)
      values (${id}, 'Personal', ${id}, now(), 'personal')
      on conflict do nothing
    )
    insert into member (id, organization_id, user_id, role, created_at)
    values (${"mp_" + user.id}, ${id}, ${user.id}, 'admin', now())
    on conflict do nothing
  `);
}

// The Seattle Solvers member row matches the allowlist: role copied, or removed.
export async function syncSeedTeamMembership(db: DB, user: { id: string; email: string }): Promise<void> {
  const role = await getRole(db, user.email);
  const memberId = `mt_${user.id}`;
  if (!role) {
    await db.execute(sql`delete from member where id = ${memberId}`);
    return;
  }
  await db.execute(sql`
    insert into member (id, organization_id, user_id, role, created_at)
    values (${memberId}, ${SEED_TEAM_ID}, ${user.id}, ${role}, now())
    on conflict (id) do update set role = excluded.role
  `);
}

export async function rememberSpace(db: DB, userId: string, spaceId: string): Promise<void> {
  await db.execute(sql`
    insert into space_visits (user_id, space_id, visited_at)
    values (${userId}, ${spaceId}, now())
    on conflict (user_id) do update set space_id = excluded.space_id, visited_at = excluded.visited_at
  `);
}

// The last space visited if the viewer is still a member, else their personal space.
export async function lastSpace(db: DB, userId: string): Promise<MySpace> {
  const result = await db.execute(sql`
    select o.id, o.slug, o.name, o.kind, m.role
    from space_visits v
    join member m on m.organization_id = v.space_id and m.user_id = v.user_id
    join organization o on o.id = v.space_id
    where v.user_id = ${userId}
  `);
  const row = rowsOf<SpaceRow>(result)[0];
  if (row) return toMySpace(row);
  const personal = await findMySpace(db, userId, PERSONAL_ALIAS);
  if (!personal) throw new Error(`No personal space for user ${userId}`);
  return personal;
}

export async function spaceOfProject(db: DB, projectId: string): Promise<string | null> {
  const rows = await db
    .select({ spaceId: projects.spaceId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  return rows[0]?.spaceId ?? null;
}

export async function spaceOfAsset(db: DB, assetId: string): Promise<string | null> {
  const rows = await db
    .select({ spaceId: assets.spaceId })
    .from(assets)
    .where(and(eq(assets.id, assetId), isNull(assets.removedAt)));
  return rows[0]?.spaceId ?? null;
}

export async function spaceOfFolder(db: DB, folderId: string): Promise<string | null> {
  const rows = await db.select({ spaceId: folders.spaceId }).from(folders).where(eq(folders.id, folderId));
  return rows[0]?.spaceId ?? null;
}
