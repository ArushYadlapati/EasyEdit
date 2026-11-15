import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rowsOf } from "@/db";
import { user } from "@/db/schema";
import { addEntry, removeEntry, SEED_ADMIN_EMAIL, seedAdmin } from "@/lib/allowlist/service";
import { makeSessionCreateBefore, makeUserCreateAfter, makeUserCreateBefore } from "@/lib/auth-hooks";
import { listMySpaces } from "@/lib/spaces/service";
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
});
