import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rowsOf } from "@/db";
import { user } from "@/db/schema";
import { addEntry, removeEntry, SEED_ADMIN_EMAIL, seedAdmin } from "@/lib/allowlist/service";
import { makeSessionCreateBefore, makeUserCreateAfter, makeUserCreateBefore } from "@/lib/auth-hooks";
import type { Actor } from "@/lib/actor";
import { actorIn } from "@/lib/spaces/access";
import { inviteToTeam } from "@/lib/spaces/invites";
import { createTeam, ensurePersonalSpace, listMySpaces } from "@/lib/spaces/service";
import { testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

// Better Auth's APIError (better-call) keeps the payload on `.body`, so the message is matched at `body.message`.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth database hooks", () => {
  it("user.create.before rejects a non-allowlisted email", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(makeUserCreateBefore(db)({ email: "rando@gmail.com" })).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { message: "NOT_ALLOWLISTED" },
    });
  });

  it("user.create.before accepts and normalizes an allowlisted email", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(makeUserCreateBefore(db)({ email: "Admin@SeattleSolvers.com", emailVerified: true })).resolves.toEqual({
      data: { email: "admin@seattlesolvers.com", emailVerified: true },
    });
  });

  it("user.create.before keeps the other user fields", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    const payload = { email: " Admin@SeattleSolvers.com ", name: "Admin", image: null, emailVerified: true };
    await expect(makeUserCreateBefore(db)(payload)).resolves.toEqual({
      data: { email: "admin@seattlesolvers.com", name: "Admin", image: null, emailVerified: true },
    });
  });

  it("user.create.before rejects an allowlisted email that Google marks unverified", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(
      makeUserCreateBefore(db)({ email: "admin@seattlesolvers.com", name: "Admin", emailVerified: false }),
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { message: "NOT_ALLOWLISTED" },
    });
  });

  for (const flag of [undefined, "true"]) {
    it(`user.create.before rejects an email with no verified mark at all (OPEN_SIGNUP ${flag ?? "unset"})`, async () => {
      if (flag) vi.stubEnv("OPEN_SIGNUP", flag);
      const db = await makeTestDb();
      await seedAdmin(db);
      for (const email of ["admin@seattlesolvers.com", "rando@gmail.com"]) {
        await expect(makeUserCreateBefore(db)({ email, name: "Someone" })).rejects.toMatchObject({ status: "FORBIDDEN", body: { message: "NOT_ALLOWLISTED" } });
      }
      // With sign-up open, a verified email is enough.
      if (flag) await expect(makeUserCreateBefore(db)({ email: "rando@gmail.com", emailVerified: true })).resolves.toEqual({ data: { email: "rando@gmail.com", emailVerified: true } });
    });
  }

  it("session.create.before allows an allowlisted user", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "viewer", invitedBy: SEED_ADMIN_EMAIL });
    await db.insert(user).values({ id: "u1", name: "Kid", email: "kid@gmail.com" });
    await expect(makeSessionCreateBefore(db)({ userId: "u1" })).resolves.toBeUndefined();
  });

  it("session.create.before rejects a user removed from the allowlist", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await db.insert(user).values({ id: "u1", name: "Kid", email: "kid@gmail.com" });
    await removeEntry(db, "kid@gmail.com");
    await expect(makeSessionCreateBefore(db)({ userId: "u1" })).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { message: "NOT_ALLOWLISTED" },
    });
  });

  it("session.create.before rejects an unknown user id", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(makeSessionCreateBefore(db)({ userId: "missing" })).rejects.toMatchObject({
      body: { message: "NOT_ALLOWLISTED" },
    });
  });

  it("a new allowlisted user gets a personal space and joins Seattle Solvers with their allowlist role", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await db.insert(user).values({ id: "u1", name: "Kid", email: "kid@gmail.com" });
    await makeUserCreateAfter(db)({ id: "u1", email: "kid@gmail.com" });
    const spaces = await listMySpaces(db, "u1");
    expect(spaces.map((s) => [s.id, s.kind, s.role])).toEqual([
      ["personal_u1", "personal", "admin"],
      ["team_seattle_solvers", "team", "editor"],
    ]);
  });

  it("signing in again repairs a missing personal space and an out-of-date team role", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await db.insert(user).values({ id: "u1", name: "Kid", email: "kid@gmail.com" });
    await makeUserCreateAfter(db)({ id: "u1", email: "kid@gmail.com" });
    await db.execute(sql`delete from member where user_id = 'u1' and organization_id = 'personal_u1'`);
    await db.execute(sql`update member set role = 'viewer' where id = 'mt_u1'`);
    await makeSessionCreateBefore(db)({ userId: "u1" });
    const spaces = await listMySpaces(db, "u1");
    expect(spaces.map((s) => [s.id, s.role])).toEqual([
      ["personal_u1", "admin"],
      ["team_seattle_solvers", "editor"],
    ]);
    const members = rowsOf<{ id: string }>(await db.execute(sql`select id from member where user_id = 'u1' order by id`));
    expect(members.map((m) => m.id)).toEqual(["mp_u1", "mt_u1"]);
  });

  describe("with sign-up closed and an email that is not on the allowlist", () => {
    const rando = { email: "rando@gmail.com", emailVerified: true };
    async function setup() {
      const db = await makeTestDb();
      await seedAdmin(db);
      await db.insert(user).values({ id: "u1", name: "Uma", email: "u1@gmail.com", emailVerified: true });
      await ensurePersonalSpace(db, { id: "u1" });
      const team = await createTeam(db, { name: "Robotics Club", byUserId: "u1" });
      const admin = (await actorIn(db, testUser({ id: "u1" }), team.id)) as Actor;
      return { db, admin, team };
    }
    const refused = { status: "FORBIDDEN", body: { message: "NOT_ALLOWLISTED" } };

    it("user create is allowed for an email with a pending invite", async () => {
      const { db, admin } = await setup();
      await inviteToTeam(db, admin, { email: "rando@gmail.com", role: "editor" });
      await expect(makeUserCreateBefore(db)(rando)).resolves.toEqual({ data: rando });
    });

    it("user create is refused when the only invite expired", async () => {
      const { db, admin } = await setup();
      await inviteToTeam(db, admin, { email: "rando@gmail.com", role: "editor" }, { now: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) });
      await expect(makeUserCreateBefore(db)(rando)).rejects.toMatchObject(refused);
    });

    it("session create is allowed for a team member who is not allowlisted", async () => {
      const { db } = await setup();
      await expect(makeSessionCreateBefore(db)({ userId: "u1" })).resolves.toBeUndefined();
    });

    it("session create is allowed with a pending invite", async () => {
      const { db, admin } = await setup();
      await db.insert(user).values({ id: "u2", name: "Rando", email: "rando@gmail.com", emailVerified: true });
      await inviteToTeam(db, admin, { email: "rando@gmail.com", role: "editor" });
      await expect(makeSessionCreateBefore(db)({ userId: "u2" })).resolves.toBeUndefined();
    });

    it("session create is still refused with no team, no invite, not allowlisted", async () => {
      const { db } = await setup();
      await db.insert(user).values({ id: "u2", name: "Rando", email: "rando@gmail.com", emailVerified: true });
      await ensurePersonalSpace(db, { id: "u2" });
      await expect(makeSessionCreateBefore(db)({ userId: "u2" })).rejects.toMatchObject(refused);
    });

    it("session create refuses someone removed from the allowlist whose only team was Seattle Solvers", async () => {
      const { db } = await setup();
      await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
      await db.insert(user).values({ id: "u3", name: "Kid", email: "kid@gmail.com", emailVerified: true });
      await makeUserCreateAfter(db)({ id: "u3", email: "kid@gmail.com" });
      await db.execute(sql`delete from allowlist where email = 'kid@gmail.com'`);
      await expect(makeSessionCreateBefore(db)({ userId: "u3" })).rejects.toMatchObject(refused);
    });

    // inAnyTeam leaves Seattle Solvers out, so the refusal alone cannot tell the order apart; the row repair can.
    it("the session hook repairs the Seattle Solvers row before the gate: a stale row is gone, a missing one is back", async () => {
      const { db } = await setup();
      const seedRows = async (id: string) => rowsOf<{ id: string }>(await db.execute(sql`select id from member where user_id = ${id} and organization_id = 'team_seattle_solvers'`));

      await db.insert(user).values({ id: "u4", name: "Stale", email: "stale@gmail.com", emailVerified: true });
      await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at) values ('mt_u4', 'team_seattle_solvers', 'u4', 'editor', now())`);
      expect(await seedRows("u4")).toHaveLength(1);
      await expect(makeSessionCreateBefore(db)({ userId: "u4" })).rejects.toMatchObject(refused);
      expect(await seedRows("u4")).toEqual([]);

      await addEntry(db, { email: "fresh@gmail.com", role: "viewer", invitedBy: SEED_ADMIN_EMAIL });
      await db.insert(user).values({ id: "u5", name: "Fresh", email: "fresh@gmail.com", emailVerified: true });
      expect(await seedRows("u5")).toEqual([]);
      await expect(makeSessionCreateBefore(db)({ userId: "u5" })).resolves.toBeUndefined();
      expect(await seedRows("u5")).toEqual([{ id: "mt_u5" }]);
    });

    it("an unverified Google email is refused even with an invite", async () => {
      const { db, admin } = await setup();
      await inviteToTeam(db, admin, { email: "rando@gmail.com", role: "editor" });
      await expect(makeUserCreateBefore(db)({ email: "rando@gmail.com", emailVerified: false })).rejects.toMatchObject(refused);
    });
  });
});
