import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";

// An actor for a service call. Defaults: "u1", an admin of Seattle Solvers.
export function testActor(over: Partial<Actor> = {}): Actor {
  return { userId: "u1", email: "u1@gmail.com", role: "admin", spaceId: SEED_TEAM_ID, ...over };
}

// A signed-in person as a route handler sees them. Defaults: "u1", an admin on the allowlist.
export function testUser(over: Partial<CurrentUser> = {}): CurrentUser {
  const id = over.id ?? "u1";
  return { id, email: `${id}@gmail.com`, name: id.toUpperCase(), image: null, allowlistRole: "admin", ...over };
}

// Makes the person a member of a space (Seattle Solvers by default) with this role, writing their user row first if
// it is missing. A second call changes the role.
export async function joinSpace(db: DB, person: { id: string; email?: string; name?: string }, role: Role, spaceId: string = SEED_TEAM_ID): Promise<void> {
  const email = person.email ?? `${person.id}@gmail.com`;
  await db.insert(user).values({ id: person.id, name: person.name ?? person.id.toUpperCase(), email, emailVerified: true }).onConflictDoNothing();
  const memberId = spaceId === SEED_TEAM_ID ? `mt_${person.id}` : `m_${person.id}_${spaceId}`;
  await db.execute(sql`
    insert into member (id, organization_id, user_id, role, created_at)
    values (${memberId}, ${spaceId}, ${person.id}, ${role}, now())
    on conflict (id) do update set role = excluded.role
  `);
}

// A member of Seattle Solvers with this role, signed in: their member row is written, and the user is returned.
export async function signedInMember(db: DB, role: Role, over: Partial<CurrentUser> = {}): Promise<CurrentUser> {
  const me = testUser({ allowlistRole: role, ...over });
  await joinSpace(db, me, role);
  return me;
}
