import { and, eq, isNull, sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { assets, folders, projects } from "@/db/schema";
import { getRole, type Role } from "@/lib/allowlist/service";
import { nanoid } from "nanoid";
import { LIMITS } from "@/lib/limits";
import { failedOn } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { personalSpacesOpen } from "./personal";
import { isReservedSlug, slugFromName, withSuffix } from "./slugs";
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

// True when the user is a member of a team other than Seattle Solvers (a personal space does not count, and Seattle
// Solvers membership follows the allowlist, so a stale row there must never let someone in).
export async function inAnyTeam(db: DB, userId: string): Promise<boolean> {
  const result = await db.execute(sql`
    select 1 as one from member m join organization o on o.id = m.organization_id
    where m.user_id = ${userId} and o.kind = 'team' and o.id <> ${SEED_TEAM_ID} limit 1
  `);
  return rowsOf<{ one: number }>(result).length > 0;
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

// The last space visited if the viewer is still a member, else their personal space. While personal spaces are not
// offered (personalSpacesOpen), a team instead: the last one visited, else their first by name. Only someone in no
// team at all gets their personal space, whose page says it is coming soon.
export async function lastSpace(db: DB, userId: string, env: NodeJS.ProcessEnv = process.env): Promise<MySpace> {
  const open = personalSpacesOpen(env);
  const result = await db.execute(sql`
    select o.id, o.slug, o.name, o.kind, m.role
    from space_visits v
    join member m on m.organization_id = v.space_id and m.user_id = v.user_id
    join organization o on o.id = v.space_id
    where v.user_id = ${userId}
  `);
  const row = rowsOf<SpaceRow>(result)[0];
  if (row && (open || row.kind === "team")) return toMySpace(row);
  if (!open) {
    const team = (await listMySpaces(db, userId)).find((space) => space.kind === "team");
    if (team) return team;
  }
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

const SLUG_INDEX = "organization_slug_unique";
const SLUG_ATTEMPTS = 50;
const SLUG_EXHAUSTED = "Couldn't make a web address for that name. Try a different name.";
const TEAM_NAME_INVALID = `Give the team a name of up to ${LIMITS.teamNameChars} characters.`;
const TEAM_NAME_PERSONAL = 'Pick a different name. "Personal" is your own space.';

// Characters a name could hide or reorder text with: C0 and C1 controls (and DEL), zero-width spaces and joiners,
// direction marks, embeddings and overrides, invisible operators and isolates, and the byte order mark.
const HIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

// A team's name as it is kept: runs of whitespace (tabs and newlines too) become one space, hidden characters go, and
// the ends are trimmed.
function cleanTeamName(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(HIDDEN_CHARS, "").replace(/\s+/g, " ").trim();
}

// A new team with the creator as its admin. The address comes from the name, made unique (case-insensitively) with -2,
// -3 …; the organization and the member row go in as one statement, and a clash from a simultaneous create tries the
// next suffix.
export async function createTeam(db: DB, input: { name: string; byUserId: string; now?: Date }): Promise<MySpace> {
  const name = cleanTeamName(input.name);
  if (name.length < 1 || name.length > LIMITS.teamNameChars) throw new ServiceError("INVALID", 400, TEAM_NAME_INVALID);
  if (name.toLowerCase() === "personal") throw new ServiceError("INVALID", 400, TEAM_NAME_PERSONAL);
  const now = input.now ?? new Date();
  const stamp = now.toISOString();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // The creator is recorded in the organization's metadata, so only teams this person made count, and leaving a team or
  // being removed from it does not give the count back.
  const metadata = JSON.stringify({ createdBy: input.byUserId });
  const made = await db.execute(sql`
    select count(*)::int as n from organization
    where kind = 'team' and metadata = ${metadata} and created_at > ${since.toISOString()}
  `);
  if ((rowsOf<{ n: number }>(made)[0]?.n ?? 0) >= LIMITS.teamsPerDay) {
    throw new ServiceError("LIMIT_EXCEEDED", 400, `You've made ${LIMITS.teamsPerDay} teams today. Try again tomorrow.`);
  }
  const base = slugFromName(name);
  for (let n = 1; n <= SLUG_ATTEMPTS; n++) {
    const slug = withSuffix(base, n);
    if (isReservedSlug(slug)) continue;
    const taken = await db.execute(sql`select 1 from organization where lower(slug) = ${slug}`);
    if (rowsOf(taken).length > 0) continue;
    const id = "team_" + nanoid(12);
    try {
      await db.execute(sql`
        with org as (
          insert into organization (id, name, slug, created_at, kind, metadata)
          values (${id}, ${name}, ${slug}, ${stamp}, 'team', ${metadata})
        )
        insert into member (id, organization_id, user_id, role, created_at)
        values (${"m_" + nanoid(12)}, ${id}, ${input.byUserId}, 'admin', ${stamp})
      `);
    } catch (error) {
      if (failedOn(error, "23505", SLUG_INDEX)) continue;
      throw error;
    }
    return { id, slug, name, kind: "team", role: "admin" };
  }
  throw new ServiceError("CONFLICT", 409, SLUG_EXHAUSTED);
}
