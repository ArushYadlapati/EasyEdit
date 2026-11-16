import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { rowsOf, type DB } from "@/db";
import { invitation, user } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { normalizeEmail, type Role } from "@/lib/allowlist/service";
import { FORBIDDEN_BODY } from "@/lib/api-errors";
import { LIMITS, type Limits } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";
import { changeableTeam, checkedRole, EMAIL_MAX_CHARS, lockedAdmins, teamOnly } from "./members";

export const INVITE_DAYS = 7;
const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;

// A waiting invite, as the Members screen shows it. `invitedBy` is the inviter's name.
export type PendingInvite = { id: string; email: string; role: Role; invitedBy: string; createdAt: Date; expiresAt: Date; expired: boolean };

const forbidden = () => new ServiceError("FORBIDDEN", 403, FORBIDDEN_BODY.message);

// Invites someone by email, whether or not they have an account (the answer is the same either way, so it doesn't reveal
// who has one). One statement: the caller still an admin, the email not already in the team, and the team under both
// caps. Inviting an email that already has a waiting invite renews it (new role, new expiry) through the partial unique
// index. The caps count unexpired invites except this email's own, which is the row being renewed.
export async function inviteToTeam(
  db: DB,
  actor: Actor,
  input: { email: string; role: Role },
  opts: { limits?: Limits; now?: Date } = {},
): Promise<PendingInvite> {
  const limits = opts.limits ?? LIMITS;
  const now = opts.now ?? new Date();
  const spaceId = await changeableTeam(db, actor, { admin: true });
  const email = normalizeEmail(typeof input.email === "string" ? input.email : "");
  if (email.length === 0 || email.length > EMAIL_MAX_CHARS || !z.email().safeParse(email).success) {
    throw new ServiceError("INVALID", 400, "Enter an email address.");
  }
  const role = checkedRole(input.role);
  const expiresAt = new Date(now.getTime() + INVITE_MS);
  const nowIso = now.toISOString();
  const result = await db.execute(sql`
    with ${lockedAdmins(spaceId, actor.userId)}, ${teamOnly(spaceId)},
      counts as (
        select
          exists (select 1 from member m join "user" u on u.id = m.user_id where m.organization_id = ${spaceId} and lower(trim(u.email)) = ${email}) as already,
          (select count(*)::int from member where organization_id = ${spaceId}) as members,
          (select count(*)::int from invitation
            where organization_id = ${spaceId} and status = 'pending' and expires_at > ${nowIso}::timestamp and email <> ${email}) as others
      ),
      saved as (
        insert into invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id)
        select ${"inv_" + nanoid(12)}, team.id, ${email}, ${role}, 'pending', ${expiresAt.toISOString()}::timestamp, ${nowIso}::timestamp, ${actor.userId}
        from gate, team, counts
        where gate.caller_admin and not counts.already
          and counts.members + counts.others < ${limits.teamMembers}
          and counts.others < ${limits.teamPendingInvites}
        on conflict (organization_id, email) where status = 'pending'
        do update set role = excluded.role, expires_at = excluded.expires_at, inviter_id = excluded.inviter_id, created_at = excluded.created_at
        returning id
      )
    select
      (select id from saved) as id,
      (select caller_admin from gate) as caller_admin,
      counts.already, counts.members, counts.others,
      (select name from "user" where id = ${actor.userId}) as inviter_name
    from counts
  `);
  type Row = { id: string | null; caller_admin: boolean; already: boolean; members: number; others: number; inviter_name: string | null };
  const row = rowsOf<Row>(result)[0];
  if (!row.id) {
    if (!row.caller_admin) throw forbidden();
    if (row.already) throw new ServiceError("ALREADY_MEMBER", 409, "They're already in this team.");
    if (row.members + row.others >= limits.teamMembers) {
      throw new ServiceError("LIMIT_EXCEEDED", 400, `A team can have up to ${limits.teamMembers} members, counting invites.`);
    }
    if (row.others >= limits.teamPendingInvites) {
      throw new ServiceError("LIMIT_EXCEEDED", 400, `This team has ${limits.teamPendingInvites} invites waiting. Cancel some first.`);
    }
    // They joined while this ran.
    throw new ServiceError("ALREADY_MEMBER", 409, "They're already in this team.");
  }
  return { id: row.id, email, role, invitedBy: row.inviter_name ?? "", createdAt: now, expiresAt, expired: false };
}

// The team's waiting invites, newest first, for its admins. Ones past their expiry are still listed, marked expired.
export async function listPendingInvites(db: DB, actor: Actor, now: Date = new Date()): Promise<PendingInvite[]> {
  const spaceId = await changeableTeam(db, actor, { admin: true });
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedBy: user.name,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(and(eq(invitation.organizationId, spaceId), eq(invitation.status, "pending")))
    .orderBy(desc(invitation.createdAt), desc(invitation.id));
  return rows.map((r) => ({ ...r, role: r.role as Role, expired: r.expiresAt.getTime() <= now.getTime() }));
}

// Takes back a waiting invite. One statement, so an admin demoted a moment ago can't still cancel.
export async function cancelInvite(db: DB, actor: Actor, inviteId: string): Promise<void> {
  const spaceId = await changeableTeam(db, actor, { admin: true });
  const result = await db.execute(sql`
    with ${lockedAdmins(spaceId, actor.userId)}, ${teamOnly(spaceId)},
      canceled as (
        update invitation set status = 'canceled'
        from gate
        where invitation.organization_id in (select id from team) and invitation.id = ${inviteId}
          and invitation.status = 'pending' and gate.caller_admin
        returning invitation.id
      )
    select exists (select 1 from canceled) as changed, (select caller_admin from gate) as caller_admin
  `);
  const row = rowsOf<{ changed: boolean; caller_admin: boolean }>(result)[0];
  if (row.changed) return;
  if (!row.caller_admin) throw forbidden();
  throw new ServiceError("NOT_FOUND", 404, "That invite is gone.");
}
