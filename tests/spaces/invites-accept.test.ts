import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf, type DB } from "@/db";
import { user } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { actorIn } from "@/lib/spaces/access";
import { acceptInvite, declineInvite, findInvite, hasPendingInvite, inviteToTeam, listMyInvites } from "@/lib/spaces/invites";
import { removeMember } from "@/lib/spaces/members";
import { createTeam, ensurePersonalSpace, listMySpaces } from "@/lib/spaces/service";
import { testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const DAY = 24 * 60 * 60 * 1000;
const err = (code: string, status: number, message: string) => ({ code, status, message });
const NOT_FOUND = err("NOT_FOUND", 404, "This invite link doesn't work.");
const WRONG = err("WRONG_ACCOUNT", 403, "This invite is for a different email address.");
const EXPIRED = err("EXPIRED", 410, "This invite has expired. Ask a team admin for a new one.");
const USED = err("INVITE_USED", 409, "This invite has already been used or cancelled.");
const FULL = err("LIMIT_EXCEEDED", 400, "This team is full.");

async function setup() {
  const db = await makeTestDb();
  for (const [id, name, email] of [
    ["u1", "Uma", "u1@gmail.com"],
    ["u2", "Ben", "u2@gmail.com"],
    ["ada", "Ada", "ada@example.com"],
  ]) {
    await db.insert(user).values({ id, name, email, emailVerified: true });
    await ensurePersonalSpace(db, { id });
  }
  const team = await createTeam(db, { name: "Robotics Club", byUserId: "u1" });
  const admin = (await actorIn(db, testUser({ id: "u1" }), team.id)) as Actor;
  return { db, team: team.id, slug: team.slug, admin };
}

const ada = { id: "ada", email: "ada@example.com" };
const invite = (db: DB, admin: Actor, role: "editor" | "admin" = "editor", now?: Date) =>
  inviteToTeam(db, admin, { email: "ada@example.com", role }, { now });
async function status(db: DB, id: string) {
  return rowsOf<{ status: string }>(await db.execute(sql`select status from invitation where id = ${id}`))[0].status;
}

describe("accepting an invite", () => {
  it("accepting adds the member with the invited role and marks it accepted", async () => {
    const { db, admin, slug } = await setup();
    const inv = await invite(db, admin, "editor");
    expect(await acceptInvite(db, ada, inv.id)).toEqual({ teamSlug: slug });
    expect(await status(db, inv.id)).toBe("accepted");
    expect((await listMySpaces(db, "ada")).find((s) => s.slug === slug)).toMatchObject({ role: "editor", kind: "team" });
  });

  it("accepts when the account email differs only in case", async () => {
    const { db, admin, slug } = await setup();
    const inv = await invite(db, admin);
    expect(await acceptInvite(db, { id: "ada", email: " Ada@Example.COM " }, inv.id)).toEqual({ teamSlug: slug });
  });

  it("a different account is refused", async () => {
    const { db, admin } = await setup();
    const inv = await invite(db, admin);
    await expect(acceptInvite(db, { id: "u2", email: "u2@gmail.com" }, inv.id)).rejects.toMatchObject(WRONG);
    expect(await status(db, inv.id)).toBe("pending");
  });

  it("an expired invite is refused", async () => {
    const { db, admin } = await setup();
    const start = new Date("2026-11-01T12:00:00.000Z");
    const inv = await invite(db, admin, "editor", start);
    await expect(acceptInvite(db, ada, inv.id, { now: new Date(start.getTime() + 7 * DAY) })).rejects.toMatchObject(EXPIRED);
  });

  it("an accepted invite can't be used again, even after the person is removed", async () => {
    const { db, admin } = await setup();
    const inv = await invite(db, admin);
    await acceptInvite(db, ada, inv.id);
    await removeMember(db, admin, "ada");
    await expect(acceptInvite(db, ada, inv.id)).rejects.toMatchObject(USED);
  });

  it("a cancelled invite is refused", async () => {
    const { db, admin } = await setup();
    const inv = await invite(db, admin);
    await db.execute(sql`update invitation set status = 'canceled' where id = ${inv.id}`);
    await expect(acceptInvite(db, ada, inv.id)).rejects.toMatchObject(USED);
  });

  it("accepting when already a member succeeds", async () => {
    const { db, admin, slug, team } = await setup();
    const inv = await invite(db, admin, "editor");
    await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at) values ('m_ada', ${team}, 'ada', 'admin', now())`);
    expect(await acceptInvite(db, ada, inv.id)).toEqual({ teamSlug: slug });
    expect(await status(db, inv.id)).toBe("accepted");
    expect((await listMySpaces(db, "ada")).find((s) => s.slug === slug)?.role).toBe("admin");
  });

  it("a full team refuses", async () => {
    const { db, admin } = await setup();
    const inv = await invite(db, admin);
    const limits = { ...LIMITS, teamMembers: 1 };
    await expect(acceptInvite(db, ada, inv.id, { limits })).rejects.toMatchObject(FULL);
    expect(await status(db, inv.id)).toBe("pending");
  });

  it("an unknown id is not found", async () => {
    const { db } = await setup();
    await expect(acceptInvite(db, ada, "nope")).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("declining and listing", () => {
  it("decline marks it declined; it leaves listMyInvites", async () => {
    const { db, admin } = await setup();
    const inv = await invite(db, admin);
    expect(await listMyInvites(db, "ada@example.com")).toHaveLength(1);
    await declineInvite(db, ada, inv.id);
    expect(await status(db, inv.id)).toBe("declined");
    expect(await listMyInvites(db, "ada@example.com")).toHaveLength(0);
    await expect(declineInvite(db, ada, inv.id)).rejects.toMatchObject(USED);
    await expect(declineInvite(db, { id: "u2", email: "u2@gmail.com" }, inv.id)).rejects.toMatchObject(WRONG);
  });

  it("listMyInvites shows only pending, unexpired invites for that email", async () => {
    const { db, admin } = await setup();
    const start = new Date("2026-11-01T12:00:00.000Z");
    await invite(db, admin, "editor", start);
    await inviteToTeam(db, admin, { email: "u2@gmail.com", role: "editor" }, { now: start });
    const now = new Date(start.getTime() + 1 * DAY);
    const list = await listMyInvites(db, " ADA@example.com ", now);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: "ada@example.com", role: "editor", status: "pending", teamName: "Robotics Club", invitedBy: "Uma" });
    expect(await listMyInvites(db, "ada@example.com", new Date(start.getTime() + 8 * DAY))).toHaveLength(0);
  });

  it("findInvite returns the view; null for an unknown id", async () => {
    const { db, admin, slug } = await setup();
    const inv = await invite(db, admin);
    expect(await findInvite(db, inv.id)).toEqual({
      id: inv.id, email: "ada@example.com", role: "editor", status: "pending", teamName: "Robotics Club", teamSlug: slug, invitedBy: "Uma",
    });
    expect(await findInvite(db, "nope")).toBeNull();
    expect((await findInvite(db, inv.id, new Date(Date.now() + 8 * DAY)))?.status).toBe("expired");
  });

  it("hasPendingInvite is false once expired", async () => {
    const { db, admin } = await setup();
    const start = new Date("2026-11-01T12:00:00.000Z");
    await invite(db, admin, "editor", start);
    expect(await hasPendingInvite(db, "ada@example.com", start)).toBe(true);
    expect(await hasPendingInvite(db, "ada@example.com", new Date(start.getTime() + 7 * DAY))).toBe(false);
    expect(await hasPendingInvite(db, "u2@gmail.com", start)).toBe(false);
  });
});
