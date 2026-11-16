import { describe, expect, it } from "vitest";
import { addEntry, removeEntry, SEED_ADMIN_EMAIL, seedAdmin } from "@/lib/allowlist/service";
import { meetsRole, resolveCurrentUser } from "@/lib/access-rules";
import { sql } from "drizzle-orm";
import { user } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { actorIn } from "@/lib/spaces/access";
import { inviteToTeam } from "@/lib/spaces/invites";
import { createTeam, ensurePersonalSpace } from "@/lib/spaces/service";
import { testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const kid = { id: "u1", email: "kid@gmail.com", name: "Kid", image: "https://example.com/kid.png" };

describe("access rules", () => {
  it("an allowlisted editor resolves with allowlist role editor", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await expect(resolveCurrentUser(db, kid)).resolves.toEqual({ ...kid, allowlistRole: "editor" });
  });

  it("a session user without an image resolves with image null", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(
      resolveCurrentUser(db, { id: "a1", email: "Admin@SeattleSolvers.com", name: "Admin" }),
    ).resolves.toEqual({ id: "a1", email: "admin@seattlesolvers.com", name: "Admin", image: null, allowlistRole: "admin" });
  });

  it("a user removed from the allowlist resolves to null", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await removeEntry(db, "kid@gmail.com");
    await expect(resolveCurrentUser(db, kid)).resolves.toBeNull();
  });

  it("a null session resolves to null", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(resolveCurrentUser(db, null)).resolves.toBeNull();
  });

  it("importing the access guard and the auth route needs no env vars", async () => {
    await expect(import("@/lib/access")).resolves.toHaveProperty("requireUserApi");
    await expect(import("@/app/api/auth/[...all]/route")).resolves.toHaveProperty("POST");
  });

  it("meetsRole compares role ranks", () => {
    expect(meetsRole("admin", "editor")).toBe(true);
    expect(meetsRole("viewer", "editor")).toBe(false);
    expect(meetsRole("editor", "editor")).toBe(true);
  });

  describe("with sign-up closed and the email off the allowlist", () => {
    const rando = { id: "u2", email: "rando@gmail.com", name: "Rando" };
    const expected = { ...rando, image: null, allowlistRole: null };
    async function setup() {
      const db = await makeTestDb();
      await seedAdmin(db);
      for (const [id, email] of [["u1", "u1@gmail.com"], ["u2", "rando@gmail.com"]]) {
        await db.insert(user).values({ id, name: id, email, emailVerified: true });
        await ensurePersonalSpace(db, { id });
      }
      const team = await createTeam(db, { name: "Robotics Club", byUserId: "u1" });
      const admin = (await actorIn(db, testUser({ id: "u1" }), team.id)) as Actor;
      return { db, admin, team };
    }

    it("a non-allowlisted member of a team resolves", async () => {
      const { db, team } = await setup();
      await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at) values ('m2', ${team.id}, 'u2', 'viewer', now())`);
      await expect(resolveCurrentUser(db, rando)).resolves.toEqual(expected);
    });

    it("a non-allowlisted person with a pending invite resolves", async () => {
      const { db, admin } = await setup();
      await inviteToTeam(db, admin, { email: "rando@gmail.com", role: "editor" });
      await expect(resolveCurrentUser(db, rando)).resolves.toEqual(expected);
    });

    it("no team, no invite, not allowlisted resolves to null", async () => {
      const { db } = await setup();
      await expect(resolveCurrentUser(db, rando)).resolves.toBeNull();
    });

    it("resolves to null after their only team membership is removed", async () => {
      const { db, team } = await setup();
      await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at) values ('m2', ${team.id}, 'u2', 'viewer', now())`);
      await db.execute(sql`delete from member where id = 'm2'`);
      await expect(resolveCurrentUser(db, rando)).resolves.toBeNull();
    });
  });
});
