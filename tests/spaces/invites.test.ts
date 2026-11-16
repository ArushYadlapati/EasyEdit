import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf, type DB } from "@/db";
import { member, user } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { LIMITS } from "@/lib/limits";
import { actorIn } from "@/lib/spaces/access";
import { cancelInvite, INVITE_DAYS, inviteToTeam, listPendingInvites } from "@/lib/spaces/invites";
import { createTeam, ensurePersonalSpace } from "@/lib/spaces/service";
import { SEED_TEAM_ID, personalSpaceId } from "@/lib/spaces/types";
import { testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const DAY = 24 * 60 * 60 * 1000;
const SPACE_NOT_FOUND = { code: "NOT_FOUND", status: 404, message: "Space not found" };
const MANAGED = { code: "MANAGED_ELSEWHERE", status: 409, message: "Seattle Solvers' members are managed on the Admin page." };
const FORBIDDEN = { code: "FORBIDDEN", status: 403 };
const BAD_EMAIL = { code: "INVALID", status: 400, message: "Enter an email address." };
const ALREADY = { code: "ALREADY_MEMBER", status: 409, message: "They're already in this team." };
const GONE = { code: "NOT_FOUND", status: 404, message: "That invite is gone." };

// People with accounts: u1 (who makes the team), u2, u3, and Ada.
async function setup() {
  const db = await makeTestDb();
  for (const [id, name, email] of [
    ["u1", "Uma", "u1@gmail.com"],
    ["u2", "Ben", "u2@gmail.com"],
    ["u3", "cara", "u3@gmail.com"],
    ["ada", "Ada", "ada@example.com"],
  ]) {
    await db.insert(user).values({ id, name, email, emailVerified: true });
    await ensurePersonalSpace(db, { id });
  }
  const team = await createTeam(db, { name: "Robotics Club", byUserId: "u1" });
  return { db, team: team.id };
}

async function as(db: DB, id: string, spaceId: string): Promise<Actor> {
  const actor = await actorIn(db, testUser({ id }), spaceId);
  if (!actor) throw new Error(`${id} is not in ${spaceId}`);
  return actor;
}

async function join(db: DB, team: string, userId: string, role: Role) {
  await db.insert(member).values({ id: `m_${userId}`, organizationId: team, userId, role, createdAt: new Date() });
}

async function memberCount(db: DB): Promise<number> {
  return rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from member`))[0].n;
}

describe("inviting", () => {
  it("an admin invites an email; it is listed as pending with role, inviter name and a 7-day expiry", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const now = new Date("2026-11-15T12:00:00.000Z");
    const invite = await inviteToTeam(db, admin, { email: "  New@X.com ", role: "editor" }, { now });
    expect(invite).toMatchObject({ email: "new@x.com", role: "editor", invitedBy: "Uma", expired: false });
    expect(invite.expiresAt.getTime() - now.getTime()).toBe(INVITE_DAYS * DAY);
    expect(INVITE_DAYS).toBe(7);
    const listed = await listPendingInvites(db, admin, now);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: invite.id, email: "new@x.com", role: "editor", invitedBy: "Uma", expired: false });
    expect(listed[0].createdAt.getTime()).toBe(now.getTime());
    expect(listed[0].expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it("the answer is the same whether or not the email has an account", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const before = await memberCount(db);
    const known = await inviteToTeam(db, admin, { email: "ada@example.com", role: "editor" });
    const unknown = await inviteToTeam(db, admin, { email: "new@x.com", role: "editor" });
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
    expect(known).toMatchObject({ email: "ada@example.com", role: "editor", invitedBy: "Uma", expired: false });
    expect(unknown).toMatchObject({ email: "new@x.com", role: "editor", invitedBy: "Uma", expired: false });
    expect(await memberCount(db)).toBe(before);
  });

  it("inviting again renews: same id, new role, expiry reset", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const start = new Date("2026-11-15T12:00:00.000Z");
    const later = new Date(start.getTime() + 3 * DAY);
    const first = await inviteToTeam(db, admin, { email: "new@x.com", role: "editor" }, { now: start });
    const again = await inviteToTeam(db, admin, { email: "NEW@x.com", role: "admin" }, { now: later });
    expect(again.id).toBe(first.id);
    expect(again.role).toBe("admin");
    expect(again.expiresAt.getTime()).toBe(later.getTime() + 7 * DAY);
    const listed = await listPendingInvites(db, admin, later);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: first.id, role: "admin" });
    expect(listed[0].expiresAt.getTime()).toBe(later.getTime() + 7 * DAY);
  });

  it("inviting someone already in the team is refused", async () => {
    const { db, team } = await setup();
    await join(db, team, "u2", "editor");
    const admin = await as(db, "u1", team);
    await expect(inviteToTeam(db, admin, { email: "U2@gmail.com", role: "editor" })).rejects.toMatchObject(ALREADY);
    await expect(inviteToTeam(db, admin, { email: "u1@gmail.com", role: "editor" })).rejects.toMatchObject(ALREADY);
    expect(await listPendingInvites(db, admin)).toEqual([]);
  });

  it("editors can't invite or list", async () => {
    const { db, team } = await setup();
    await join(db, team, "u2", "editor");
    const actor = await as(db, "u2", team);
    await expect(inviteToTeam(db, actor, { email: "new@x.com", role: "editor" })).rejects.toMatchObject(FORBIDDEN);
    await expect(listPendingInvites(db, actor)).rejects.toMatchObject(FORBIDDEN);
  });

  it("Seattle Solvers refuses", async () => {
    const { db } = await setup();
    const actor = { ...(await as(db, "u1", personalSpaceId("u1"))), spaceId: SEED_TEAM_ID, role: "admin" as Role };
    await db.insert(member).values({ id: "m_seed_u1", organizationId: SEED_TEAM_ID, userId: "u1", role: "admin", createdAt: new Date() });
    await expect(inviteToTeam(db, actor, { email: "new@x.com", role: "editor" })).rejects.toMatchObject(MANAGED);
    await expect(listPendingInvites(db, actor)).rejects.toMatchObject(MANAGED);
  });

  it("a personal space and a non-member answer Space not found", async () => {
    const { db, team } = await setup();
    const personal = await as(db, "u1", personalSpaceId("u1"));
    await expect(inviteToTeam(db, personal, { email: "new@x.com", role: "editor" })).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(listPendingInvites(db, personal)).rejects.toMatchObject(SPACE_NOT_FOUND);
    const outsider = { ...(await as(db, "u2", personalSpaceId("u2"))), spaceId: team, role: "admin" as Role };
    await expect(inviteToTeam(db, outsider, { email: "new@x.com", role: "editor" })).rejects.toMatchObject(SPACE_NOT_FOUND);
    await expect(listPendingInvites(db, outsider)).rejects.toMatchObject(SPACE_NOT_FOUND);
  });

  it("a bad email or role is refused", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    for (const email of ["", "   ", "not-an-email", `${"a".repeat(288)}@example.com`]) {
      await expect(inviteToTeam(db, admin, { email, role: "editor" })).rejects.toMatchObject(BAD_EMAIL);
    }
    await expect(inviteToTeam(db, admin, { email: "new@x.com", role: "owner" as Role })).rejects.toMatchObject({ code: "INVALID", status: 400, message: "Unknown role." });
    expect(await listPendingInvites(db, admin)).toEqual([]);
  });

  it("refuses an invite as viewer, a role that can't be given any more", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    await expect(inviteToTeam(db, admin, { email: "v@x.com", role: "viewer" as Role })).rejects.toMatchObject({ code: "INVALID", status: 400, message: "Unknown role." });
    expect(await listPendingInvites(db, admin)).toEqual([]);
  });

  it("members plus pending invites stay under the team cap", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const limits = { ...LIMITS, teamMembers: 2 };
    await inviteToTeam(db, admin, { email: "a@x.com", role: "editor" }, { limits });
    await expect(inviteToTeam(db, admin, { email: "b@x.com", role: "editor" }, { limits })).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
      status: 400,
      message: "A team can have up to 2 members, counting invites.",
    });
    // Renewing the invite that is already counted is fine.
    await expect(inviteToTeam(db, admin, { email: "a@x.com", role: "editor" }, { limits })).resolves.toMatchObject({ role: "editor" });
  });

  it("pending invites per team are capped", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const limits = { ...LIMITS, teamPendingInvites: 1 };
    await inviteToTeam(db, admin, { email: "a@x.com", role: "editor" }, { limits });
    await expect(inviteToTeam(db, admin, { email: "b@x.com", role: "editor" }, { limits })).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
      status: 400,
      message: "This team has 1 invite waiting. Cancel some first.",
    });
    const two = { ...LIMITS, teamPendingInvites: 2 };
    await inviteToTeam(db, admin, { email: "c@x.com", role: "editor" }, { limits: two });
    await expect(inviteToTeam(db, admin, { email: "d@x.com", role: "editor" }, { limits: two })).rejects.toMatchObject({
      message: "This team has 2 invites waiting. Cancel some first.",
    });
    expect(LIMITS.teamPendingInvites).toBe(50);
  });

  it("an expired invite is listed as expired, and inviting that email again renews it", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const start = new Date("2026-11-15T12:00:00.000Z");
    const first = await inviteToTeam(db, admin, { email: "new@x.com", role: "editor" }, { now: start });
    const late = new Date(start.getTime() + 8 * DAY);
    const listed = await listPendingInvites(db, admin, late);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: first.id, expired: true });
    const renewed = await inviteToTeam(db, admin, { email: "new@x.com", role: "editor" }, { now: late });
    expect(renewed).toMatchObject({ id: first.id, expired: false });
    expect((await listPendingInvites(db, admin, late))[0]).toMatchObject({ expired: false });
  });

  it("lists newest first", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const t = new Date("2026-11-15T12:00:00.000Z");
    await inviteToTeam(db, admin, { email: "a@x.com", role: "editor" }, { now: t });
    await inviteToTeam(db, admin, { email: "b@x.com", role: "editor" }, { now: new Date(t.getTime() + 1000) });
    expect((await listPendingInvites(db, admin, t)).map((i) => i.email)).toEqual(["b@x.com", "a@x.com"]);
  });
});

describe("cancelling", () => {
  it("takes it off the list; cancelling twice or another team's invite answers That invite is gone.", async () => {
    const { db, team } = await setup();
    const admin = await as(db, "u1", team);
    const invite = await inviteToTeam(db, admin, { email: "new@x.com", role: "editor" });
    await cancelInvite(db, admin, invite.id);
    expect(await listPendingInvites(db, admin)).toEqual([]);
    await expect(cancelInvite(db, admin, invite.id)).rejects.toMatchObject(GONE);
    const other = await createTeam(db, { name: "Other Club", byUserId: "u1" });
    const otherAdmin = await as(db, "u1", other.id);
    const theirs = await inviteToTeam(db, otherAdmin, { email: "z@x.com", role: "editor" });
    await expect(cancelInvite(db, admin, theirs.id)).rejects.toMatchObject(GONE);
    expect(await listPendingInvites(db, otherAdmin)).toHaveLength(1);
    // A cancelled invite can be sent again.
    await expect(inviteToTeam(db, admin, { email: "new@x.com", role: "editor" })).resolves.toMatchObject({ email: "new@x.com" });
  });

  it("is for admins only", async () => {
    const { db, team } = await setup();
    await join(db, team, "u2", "editor");
    const invite = await inviteToTeam(db, await as(db, "u1", team), { email: "new@x.com", role: "editor" });
    await expect(cancelInvite(db, await as(db, "u2", team), invite.id)).rejects.toMatchObject(FORBIDDEN);
    expect(await listPendingInvites(db, await as(db, "u1", team))).toHaveLength(1);
  });
});

describe("races", () => {
  it("an admin demoted while inviting is refused", async () => {
    const { db, team } = await setup();
    await join(db, team, "u2", "admin");
    const stale = await as(db, "u2", team);
    await db.execute(sql`update member set role = 'editor' where organization_id = ${team} and user_id = 'u2'`);
    await expect(inviteToTeam(db, stale, { email: "new@x.com", role: "editor" })).rejects.toMatchObject(FORBIDDEN);
    await expect(cancelInvite(db, stale, "whatever")).rejects.toMatchObject(FORBIDDEN);
    expect(await listPendingInvites(db, await as(db, "u1", team))).toEqual([]);
  });

  it("two pending invites for one email in one team can't exist", async () => {
    const { db, team } = await setup();
    const insert = (id: string) =>
      db.execute(sql`
        insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
        values (${id}, ${team}, 'dup@x.com', 'editor', 'pending', now(), 'u1')
      `);
    await insert("i1");
    await expect(insert("i2")).rejects.toThrow();
    // Once the first is answered, another may wait.
    await db.execute(sql`update invitation set status = 'canceled' where id = 'i1'`);
    await expect(insert("i3")).resolves.toBeDefined();
  });
});
