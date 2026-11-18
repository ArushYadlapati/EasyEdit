import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { driveConnection, member, spaceStorage, user } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { isAssignableRole, type AssignableRole, type Role } from "@/lib/allowlist/service";
import { FORBIDDEN_BODY } from "@/lib/api-errors";
import { ServiceError } from "@/lib/service-error";
import { socialConfig } from "@/lib/social/config";
import { dropChannel } from "@/lib/social/connections";
import { checkedTeamName } from "./service";
import { SEED_TEAM_ID } from "./types";

// A person in a team, as the Members screen shows them. `storageOwner`: the team's videos are in their Google Drive.
export type TeamMember = { userId: string; name: string; email: string; image: string | null; role: Role; joinedAt: Date; storageOwner: boolean };

export const EMAIL_MAX_CHARS = 254;

const spaceNotFound = () => new ServiceError("NOT_FOUND", 404, "Space not found");
const notInTeam = () => new ServiceError("NOT_FOUND", 404, "They're not in this team.");
const managedElsewhere = () => new ServiceError("MANAGED_ELSEWHERE", 409, "Seattle Solvers' members are managed on the Admin page.");
// requireRole's 403, for an admin demoted while their change ran.
const forbidden = () => new ServiceError("FORBIDDEN", 403, FORBIDDEN_BODY.message);
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
export async function changeableTeam(db: DB, actor: Actor, opts: { admin: boolean }): Promise<string> {
  const role = await roleInTeam(db, actor);
  if (actor.spaceId === SEED_TEAM_ID) throw managedElsewhere();
  if (opts.admin) {
    requireRole(actor, "admin");
    requireRole({ ...actor, role }, "admin");
  }
  return actor.spaceId;
}

export function checkedRole(role: unknown): AssignableRole {
  if (!isAssignableRole(role)) throw new ServiceError("INVALID", 400, "Unknown role.");
  return role;
}

// Shared pieces of every change statement. `admins` locks the team's admin rows in a fixed order, so two statements that
// could each take away an admin run one after the other, and the second counts the admins the first left. `gate` sums
// those locked rows up: how many admins there are, and whether the caller is one (so an admin demoted a moment ago can't
// still act). Every write joins `gate`, so the admin rows are always locked before the row being changed: a statement
// that locked its target first and an admin's change waiting on it could otherwise deadlock. `team` makes sure the
// statement only ever touches a team (never a personal space, never Seattle Solvers). `owner` is the person whose Google
// Drive holds the team's videos, if anyone's does.
export const lockedAdmins = (spaceId: string, callerId: string) => sql`
  admins as (select user_id from member where organization_id = ${spaceId} and role = 'admin' order by id for update),
  gate as (select count(*)::int as admin_count, coalesce(bool_or(user_id = ${callerId}), false) as caller_admin from admins)`;
export const teamOnly = (spaceId: string) =>
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
  if (!error) {
    // A YouTube channel is connected with a person's own Google account: when that person goes, so does the channel.
    await forgetChannel(db, { spaceId, onlyConnectedBy: userId });
    return;
  }
  // A leaver who was removed while this ran is no longer in the space.
  if (!opts.byAdmin && error.code === "NOT_FOUND") throw spaceNotFound();
  throw error;
}

// Removes the space's YouTube channel after a change that is already made. Never fails that change: a channel that
// could not be removed is logged, and its admins can still disconnect it (or the person can, in their Google account).
async function forgetChannel(db: DB, input: { spaceId: string; onlyConnectedBy?: string }): Promise<void> {
  try {
    await dropChannel(db, socialConfig(), input);
  } catch (error) {
    console.error("Removing a space's YouTube channel failed:", error instanceof Error ? error.name : "unknown");
  }
}

const hasProjects = () => new ServiceError("HAS_PROJECTS", 409, "Delete this team's projects first.");

type DeleteRow = { changed: boolean; caller_admin: boolean; name_ok: boolean; has_projects: boolean };

// Deletes a team: its member, invitation, space_visits and space_storage rows go, so nobody sees it and its invite links
// stop working. Its YouTube channel is disconnected too. The organization row stays (projects, folders and assets point at it with no cascade), as do the
// team's folders, assets, brand kit, pins and Drive connection. An admin only, and only with the team's name typed
// exactly, and only when no project is left in it (deleted ones don't count). One statement after the early checks, so
// an admin demoted a moment ago can't still delete. Its storage row going frees its Google account for another space.
export async function deleteTeam(db: DB, actor: Actor, input: { confirmName: string }): Promise<void> {
  if (actor.spaceId === SEED_TEAM_ID) throw new ServiceError("MANAGED_ELSEWHERE", 409, "Seattle Solvers can't be deleted.");
  const spaceId = await changeableTeam(db, actor, { admin: true });
  const typed = (input.confirmName ?? "").trim();
  const result = await db.execute(sql`
    with ${lockedAdmins(spaceId, actor.userId)}, ${teamOnly(spaceId)},
      ok as (
        select team.id from team join organization o on o.id = team.id, gate
        where gate.caller_admin and o.name = ${typed}
          and not exists (select 1 from projects p where p.space_id = team.id and p.deleted_at is null)
      ),
      del_invitation as (delete from invitation where organization_id in (select id from ok)),
      del_storage as (delete from space_storage where space_id in (select id from ok)),
      del_visits as (delete from space_visits where space_id in (select id from ok)),
      del_member as (delete from member where organization_id in (select id from ok) returning id)
    select
      exists (select 1 from ok) as changed,
      (select caller_admin from gate) as caller_admin,
      coalesce((select name = ${typed} from organization where id = ${spaceId}), false) as name_ok,
      exists (select 1 from projects where space_id = ${spaceId} and deleted_at is null) as has_projects
  `);
  const row = rowsOf<DeleteRow>(result)[0];
  if (row.changed) {
    await forgetChannel(db, { spaceId }); // nobody could reach its settings again to disconnect it
    return;
  }
  if (!row.caller_admin) throw forbidden();
  if (!row.name_ok) throw new ServiceError("INVALID", 400, "Type the team's name to delete it.");
  if (row.has_projects) throw hasProjects();
  throw spaceNotFound(); // gone while the statement ran
}

// Renames a team: an admin only, never Seattle Solvers, with createTeam's cleaning and refusals. Only the name changes,
// so the team's address (and every link to it) stays. The update joins `gate`, so an admin demoted a moment ago can't
// still rename.
export async function renameTeam(db: DB, actor: Actor, rawName: string): Promise<{ name: string }> {
  const spaceId = await changeableTeam(db, actor, { admin: true });
  const name = checkedTeamName(rawName);
  const result = await db.execute(sql`
    with ${lockedAdmins(spaceId, actor.userId)}, ${teamOnly(spaceId)},
      ok as (select team.id from team, gate where gate.caller_admin),
      upd as (update organization set name = ${name} where id in (select id from ok) returning id)
    select exists (select 1 from upd) as changed, (select caller_admin from gate) as caller_admin
  `);
  const row = rowsOf<{ changed: boolean; caller_admin: boolean }>(result)[0];
  if (row.changed) return { name };
  if (!row.caller_admin) throw forbidden();
  throw spaceNotFound();
}
