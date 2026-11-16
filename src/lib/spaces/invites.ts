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
import { SEED_TEAM_ID } from "./types";
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
// The caps are checks, not locks: only the admin rows are re-read after waiting on the admin lock, while the counts come
// from the statement's start snapshot. Invites sent at the same instant can therefore overshoot a cap slightly. The
// partial unique index still holds exactly.
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
        select ${"inv_" + nanoid(24)}, team.id, ${email}, ${role}, 'pending', ${expiresAt.toISOString()}::timestamp, ${nowIso}::timestamp, ${actor.userId}
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

export type InviteStatus = "pending" | "expired" | "accepted" | "canceled" | "declined";
export type InviteView = { id: string; email: string; role: Role; status: InviteStatus; teamName: string; teamSlug: string; invitedBy: string };

const notFound = () => new ServiceError("NOT_FOUND", 404, "This invite link doesn't work.");

type ViewRow = { id: string; email: string; role: string; status: string; expired: boolean; team_name: string; team_slug: string; invited_by: string | null };

function toView(r: ViewRow): InviteView {
  const expired = r.status === "pending" && r.expired;
  return {
    id: r.id,
    email: r.email,
    role: r.role as Role,
    status: expired ? "expired" : (r.status as InviteStatus),
    teamName: r.team_name,
    teamSlug: r.team_slug,
    invitedBy: r.invited_by ?? "",
  };
}

// An invite as the invitee sees it. Null for an unknown id, or for a team with no members left (a deleted team).
export async function findInvite(db: DB, inviteId: string, now: Date = new Date()): Promise<InviteView | null> {
  const result = await db.execute(sql`
    select i.id, i.email, i.role, i.status, i.expires_at <= ${now.toISOString()}::timestamp as expired, o.name as team_name, o.slug as team_slug, u.name as invited_by
    from invitation i
    join organization o on o.id = i.organization_id and o.kind = 'team'
    left join "user" u on u.id = i.inviter_id
    where i.id = ${inviteId} and exists (select 1 from member m where m.organization_id = o.id)
  `);
  const row = rowsOf<ViewRow>(result)[0];
  return row ? toView(row) : null;
}

// Joins the team with the invited role. One statement: the invite row is locked, must be pending, unexpired, for this
// email, and for a real team (never Seattle Solvers, never a deleted team). Already being a member is fine; the role is
// left alone. The cap counts members only, since this invite turns into one.
export async function acceptInvite(
  db: DB,
  who: { id: string; email: string },
  inviteId: string,
  opts: { limits?: Limits; now?: Date } = {},
): Promise<{ teamSlug: string }> {
  const limits = opts.limits ?? LIMITS;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const email = normalizeEmail(who.email);
  const result = await db.execute(sql`
    with inv as (select id, organization_id, email, role, status, expires_at from invitation where id = ${inviteId} for update),
      team as (
        select o.id, o.slug from organization o, inv
        where o.id = inv.organization_id and o.kind = 'team' and o.id <> ${SEED_TEAM_ID}
          and exists (select 1 from member where organization_id = o.id)
      ),
      ok as (
        select inv.id, inv.organization_id, inv.role from inv, team
        where inv.status = 'pending' and inv.expires_at > ${nowIso}::timestamp and inv.email = ${email}
      ),
      counts as (
        select
          exists (select 1 from member m, ok where m.organization_id = ok.organization_id and m.user_id = ${who.id}) as already,
          (select count(*)::int from member m, ok where m.organization_id = ok.organization_id) as members
      ),
      added as (
        insert into member (id, organization_id, user_id, role, created_at)
        select ${"m_" + nanoid(12)}, ok.organization_id, ${who.id}, ok.role, ${nowIso}::timestamp
        from ok, counts
        where not counts.already and counts.members < ${limits.teamMembers}
        on conflict (organization_id, user_id) do nothing
        returning user_id
      ),
      accepted as (
        update invitation set status = 'accepted'
        from ok, counts
        where invitation.id = ok.id and (counts.already or counts.members < ${limits.teamMembers})
        returning invitation.id
      )
    select
      exists (select 1 from accepted) as accepted,
      (select slug from team) as team_slug,
      (select email from inv) as invite_email,
      (select status from inv) as status,
      (select expires_at <= ${nowIso}::timestamp from inv) as expired,
      (select members from counts) as members
  `);
  type Row = { accepted: boolean; team_slug: string | null; invite_email: string | null; status: string | null; expired: boolean | null; members: number | null };
  const row = rowsOf<Row>(result)[0];
  if (row.accepted && row.team_slug) return { teamSlug: row.team_slug };
  if (!row.team_slug || !row.status) throw notFound();
  if (row.invite_email !== email) throw new ServiceError("WRONG_ACCOUNT", 403, "This invite is for a different email address.");
  if (row.status !== "pending") throw new ServiceError("INVITE_USED", 409, "This invite has already been used or cancelled.");
  if (row.expired) {
    throw new ServiceError("EXPIRED", 410, "This invite has expired. Ask a team admin for a new one.");
  }
  if (row.members !== null && row.members >= limits.teamMembers) throw new ServiceError("LIMIT_EXCEEDED", 400, "This team is full.");
  throw new ServiceError("INVITE_USED", 409, "This invite has already been used or cancelled.");
}

// Says no to an invite. Only the invited email can; a pending invite becomes declined.
export async function declineInvite(db: DB, who: { id: string; email: string }, inviteId: string): Promise<void> {
  const email = normalizeEmail(who.email);
  const result = await db.execute(sql`
    with inv as (select id, email, status from invitation where id = ${inviteId} for update),
      declined as (
        update invitation set status = 'declined'
        from inv where invitation.id = inv.id and inv.status = 'pending' and inv.email = ${email}
        returning invitation.id
      )
    select exists (select 1 from declined) as declined, (select email from inv) as invite_email, (select status from inv) as status
  `);
  const row = rowsOf<{ declined: boolean; invite_email: string | null; status: string | null }>(result)[0];
  if (row.declined) return;
  if (!row.status) throw notFound();
  if (row.invite_email !== email) throw new ServiceError("WRONG_ACCOUNT", 403, "This invite is for a different email address.");
  throw new ServiceError("INVITE_USED", 409, "This invite has already been used or cancelled.");
}

// Invites waiting for this email: pending and unexpired, oldest first.
export async function listMyInvites(db: DB, email: string, now: Date = new Date()): Promise<InviteView[]> {
  const result = await db.execute(sql`
    select i.id, i.email, i.role, i.status, i.expires_at <= ${now.toISOString()}::timestamp as expired, o.name as team_name, o.slug as team_slug, u.name as invited_by
    from invitation i
    join organization o on o.id = i.organization_id and o.kind = 'team' and o.id <> ${SEED_TEAM_ID}
    left join "user" u on u.id = i.inviter_id
    where i.email = ${normalizeEmail(email)} and i.status = 'pending' and i.expires_at > ${now.toISOString()}::timestamp
      and exists (select 1 from member m where m.organization_id = o.id)
    order by i.created_at, i.id
  `);
  return rowsOf<ViewRow>(result).map(toView);
}

export async function hasPendingInvite(db: DB, email: string, now: Date = new Date()): Promise<boolean> {
  return (await listMyInvites(db, email, now)).length > 0;
}
