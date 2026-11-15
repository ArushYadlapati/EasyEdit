import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { rowsOf, type DB } from "@/db";
import { driveConnection, member, spaceStorage, user } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { normalizeEmail, ROLE_RANK, type Role } from "@/lib/allowlist/service";
import { FORBIDDEN_BODY } from "@/lib/api-errors";
import { LIMITS, type Limits } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";
import { SEED_TEAM_ID } from "./types";

// A person in a team, as the Members screen shows them. `storageOwner`: the team's videos are in their Google Drive.
export type TeamMember = { userId: string; name: string; email: string; image: string | null; role: Role; joinedAt: Date; storageOwner: boolean };

const EMAIL_MAX_CHARS = 254;

const spaceNotFound = () => new ServiceError("NOT_FOUND", 404, "Space not found");
const notInTeam = () => new ServiceError("NOT_FOUND", 404, "They're not in this team.");
const managedElsewhere = () => new ServiceError("MANAGED_ELSEWHERE", 409, "Seattle Solvers' members are managed on the Admin page.");
// requireRole's 403, for an admin demoted while their change ran.
const forbidden = () => new ServiceError("FORBIDDEN", 403, FORBIDDEN_BODY.message);
const badEmail = () => new ServiceError("INVALID", 400, "Enter an email address.");
const lastAdmin = () => new ServiceError("LAST_ADMIN", 409, "A team needs at least one admin. Make someone else an admin first.");
const ownerStays = () =>
  new ServiceError("STORAGE_OWNER", 409, "This team's videos are stored in their Google Drive, so they can't leave or be removed yet.");
// Only the owner, as an admin, can reconnect the team's storage.
const ownerStaysAdmin = () =>
  new ServiceError("STORAGE_OWNER", 409, "This team's videos are stored in their Google Drive, so they need to stay an admin.");

// The acting person's role in the team the actor names, read from their member row: the actor's own role and space are
// not taken on trust. A personal space, an unknown one, one the person isn't in, and an AI agent's actor (its user id
// is not a person's) all answer like a space that doesn't exist.
async function roleInTeam(db: DB, actor: Actor): Promise<Role> {
  const result = await db.execute(sql`
    select m.role from member m join organization o on o.id = m.organization_id
    where m.organization_id = ${actor.spaceId} and m.user_id = ${actor.userId} and o.kind = 'team'
  `);
  const role = rowsOf<{ role: Role }>(result)[0]?.role;
  if (!role) throw spaceNotFound();
  return role;
}

// The checks before any change: a team the person is in, not Seattle Solvers (its members follow the allowlist), and,
// unless anyone may make the change, an admin both by the actor and by their member row.
async function changeableTeam(db: DB, actor: Actor, opts: { admin: boolean }): Promise<string> {
  const role = await roleInTeam(db, actor);
  if (actor.spaceId === SEED_TEAM_ID) throw managedElsewhere();
  if (opts.admin) {
    requireRole(actor, "admin");
    requireRole({ ...actor, role }, "admin");
  }
  return actor.spaceId;
}

function checkedRole(role: unknown): Role {
  if (typeof role !== "string" || !Object.hasOwn(ROLE_RANK, role)) throw new ServiceError("INVALID", 400, "Unknown role.");
  return role as Role;
}

// Shared pieces of every change statement. `admins` locks the team's admin rows in a fixed order, so two statements that
// could each take away an admin run one after the other, and the second counts the admins the first left. `gate` sums
// those locked rows up: how many admins there are, and whether the caller is one (so an admin demoted a moment ago can't
// still act). Every write joins `gate`, so the admin rows are always locked before the row being changed: a statement
// that locked its target first and an admin's change waiting on it could otherwise deadlock. `team` makes sure the
// statement only ever touches a team (never a personal space, never Seattle Solvers). `owner` is the person whose Google
// Drive holds the team's videos, if anyone's does.
const lockedAdmins = (spaceId: string, callerId: string) => sql`
  admins as (select user_id from member where organization_id = ${spaceId} and role = 'admin' order by id for update),
  gate as (select count(*)::int as admin_count, coalesce(bool_or(user_id = ${callerId}), false) as caller_admin from admins)`;
const teamOnly = (spaceId: string) =>
  sql`team as (select id from organization where id = ${spaceId} and kind = 'team' and id <> ${SEED_TEAM_ID})`;
const storageOwner = (spaceId: string) =>
  sql`owner as (select dc.user_id from space_storage ss join drive_connection dc on dc.id = ss.connection_id where ss.space_id = ${spaceId})`;

// Everyone in the team, for any of its members: admins first, then by name (ignoring case), then email.
export async function listTeamMembers(db: DB, actor: Actor): Promise<TeamMember[]> {
  await roleInTeam(db, actor);
  const spaceId = actor.spaceId;
  const owners = await db
    .select({ userId: driveConnection.userId })
    .from(spaceStorage)
    .innerJoin(driveConnection, eq(driveConnection.id, spaceStorage.connectionId))
    .where(eq(spaceStorage.spaceId, spaceId));
  const ownerId = owners[0]?.userId ?? null;
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, image: user.image, role: member.role, joinedAt: member.createdAt })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, spaceId))
    .orderBy(sql`(${member.role} = 'admin') desc`, sql`lower(${user.name})`, asc(user.email), asc(user.id));
  return rows.map((r) => ({ ...r, role: r.role as Role, storageOwner: r.userId === ownerId }));
}

// Adds someone who already has an account, found by email. One statement: the caller still an admin, the person not
// already in the team (the unique index on organization and user is the final guard), and the team not full.
export async function addMemberByEmail(db: DB, actor: Actor, input: { email: string; role: Role }, limits: Limits = LIMITS): Promise<TeamMember> {
  const spaceId = await changeableTeam(db, actor, { admin: true });
  const email = normalizeEmail(typeof input.email === "string" ? input.email : "");
  if (email.length === 0 || email.length > EMAIL_MAX_CHARS || !z.email().safeParse(email).success) throw badEmail();
  const role = checkedRole(input.role);
  const now = new Date();
  const result = await db.execute(sql`
    with ${lockedAdmins(spaceId, actor.userId)}, ${teamOnly(spaceId)}, ${storageOwner(spaceId)},
      target as (select id, name, email, image from "user" where lower(trim(email)) = ${email} order by id limit 1),
      added as (
        insert into member (id, organization_id, user_id, role, created_at)
        select ${"m_" + nanoid(12)}, team.id, target.id, ${role}, ${now.toISOString()}
        from gate, team, target
        where gate.caller_admin
          and not exists (select 1 from member where organization_id = ${spaceId} and user_id = target.id)
          and (select count(*) from member where organization_id = ${spaceId}) < ${limits.teamMembers}
        on conflict (organization_id, user_id) do nothing
        returning user_id
      )
    select target.id, target.name, target.email, target.image,
      exists (select 1 from added) as added,
      (select caller_admin from gate) as caller_admin,
      exists (select 1 from member where organization_id = ${spaceId} and user_id = target.id) as already,
      (select count(*)::int from member where organization_id = ${spaceId}) as members,
      exists (select 1 from owner where user_id = target.id) as storage_owner
    from target
  `);
  type Row = { id: string; name: string; email: string; image: string | null; added: boolean; caller_admin: boolean; already: boolean; members: number; storage_owner: boolean };
  const row = rowsOf<Row>(result)[0];
  if (!row) throw new ServiceError("NO_ACCOUNT", 404, "No EasyEdit account uses that email yet. Ask them to sign in once, then add them.");
  if (!row.added) {
    if (!row.caller_admin) throw forbidden();
    if (!row.already && row.members >= limits.teamMembers) {
      throw new ServiceError("LIMIT_EXCEEDED", 400, `A team can have up to ${limits.teamMembers} members.`);
    }
    // Already in the team, or added by another admin while this ran.
    throw new ServiceError("ALREADY_MEMBER", 409, "They're already in this team.");
  }
  return { userId: row.id, name: row.name, email: row.email, image: row.image, role, joinedAt: now, storageOwner: row.storage_owner };
}

type ChangeRow = { changed: boolean; caller_admin: boolean; target_role: Role | null; admins: number; is_owner: boolean };

// The outcome of a change statement as an error, when nothing changed.
// `wanted` is the new role, or null for a removal.
function refusal(row: ChangeRow, wanted: Role | null): ServiceError | null {
  if (row.changed) return null;
  if (!row.caller_admin) return forbidden();
  if (row.target_role === null) return notInTeam();
  if (row.is_owner && wanted === null) return ownerStays();
  if (row.is_owner && wanted !== "admin") return ownerStaysAdmin();
  if (row.target_role === "admin" && wanted !== "admin" && row.admins <= 1) return lastAdmin();
  return notInTeam(); // gone while the statement ran
}

// Changes a member's role. One statement: the caller still an admin, the team keeping an admin, and the storage owner
// staying an admin.
export async function setMemberRole(db: DB, actor: Actor, input: { userId: string; role: Role }): Promise<void> {
  const spaceId = await changeableTeam(db, actor, { admin: true });
  const role = checkedRole(input.role);
  const result = await db.execute(sql`
    with ${lockedAdmins(spaceId, actor.userId)}, ${teamOnly(spaceId)}, ${storageOwner(spaceId)},
      changed as (
        update member set role = ${role}
        from gate
        where member.organization_id in (select id from team) and member.user_id = ${input.userId}
          and gate.caller_admin
          and (member.role <> 'admin' or ${role} = 'admin' or gate.admin_count > 1)
          and (${role} = 'admin' or not exists (select 1 from owner where owner.user_id = member.user_id))
        returning member.user_id
      )
    select
      exists (select 1 from changed) as changed,
      (select caller_admin from gate) as caller_admin,
      (select role from member where organization_id = ${spaceId} and user_id = ${input.userId}) as target_role,
      (select admin_count from gate) as admins,
      exists (select 1 from owner where user_id = ${input.userId}) as is_owner
  `);
  const error = refusal(rowsOf<ChangeRow>(result)[0], role);
  if (error) throw error;
}

// Takes someone else out of the team. One statement: the caller still an admin, the team keeping an admin, and the
// storage owner staying.
export async function removeMember(db: DB, actor: Actor, userId: string): Promise<void> {
  const spaceId = await changeableTeam(db, actor, { admin: true });
  if (userId === actor.userId) throw new ServiceError("INVALID", 400, "To leave the team, use Leave team.");
  await deleteMember(db, actor, spaceId, userId, { byAdmin: true });
}

// Takes the caller out of the team. Any member may, unless they are its last admin or its storage owner.
export async function leaveTeam(db: DB, actor: Actor): Promise<void> {
  const spaceId = await changeableTeam(db, actor, { admin: false });
  await deleteMember(db, actor, spaceId, actor.userId, { byAdmin: false });
}

async function deleteMember(db: DB, actor: Actor, spaceId: string, userId: string, opts: { byAdmin: boolean }): Promise<void> {
  // Leaving needs no admin; the admin rows are still locked first, through `gate`.
  const callerAdmin = opts.byAdmin ? sql`gate.caller_admin` : sql`true`;
  const result = await db.execute(sql`
    with ${lockedAdmins(spaceId, actor.userId)}, ${teamOnly(spaceId)}, ${storageOwner(spaceId)},
      gone as (
        delete from member
        using gate
        where member.organization_id in (select id from team) and member.user_id = ${userId}
          and ${callerAdmin}
          and (member.role <> 'admin' or gate.admin_count > 1)
          and not exists (select 1 from owner where owner.user_id = member.user_id)
        returning member.user_id
      )
    select
      exists (select 1 from gone) as changed,
      (select ${callerAdmin} from gate) as caller_admin,
      (select role from member where organization_id = ${spaceId} and user_id = ${userId}) as target_role,
      (select admin_count from gate) as admins,
      exists (select 1 from owner where user_id = ${userId}) as is_owner
  `);
  const row = rowsOf<ChangeRow>(result)[0];
  const error = refusal(row, null);
  if (!error) return;
  // A leaver who was removed while this ran is no longer in the space.
  if (!opts.byAdmin && error.code === "NOT_FOUND") throw spaceNotFound();
  throw error;
}
