import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf } from "@/db";
import { session, user } from "@/db/schema";
import {
  AllowlistError,
  ROLE_RANK,
  SEED_ADMIN_EMAIL,
  addEntry,
  getRole,
  listEntries,
  normalizeEmail,
  removeEntry,
  seedAdmin,
  setRole,
} from "@/lib/allowlist/service";
import { makeTestDb } from "../helpers/db";

describe("allowlist service", () => {
  it("exposes role ranks and normalizeEmail", () => {
    expect(ROLE_RANK).toEqual({ viewer: 1, editor: 2, admin: 3 });
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });

  it("seedAdmin is idempotent and makes admin@seattlesolvers.com an admin", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await seedAdmin(db);
    expect(await getRole(db, "admin@seattlesolvers.com")).toBe("admin");
    const entries = await listEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].invitedBy).toBeNull();
  });

  it("lookups ignore case and whitespace", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    expect(await getRole(db, "  Admin@SeattleSolvers.com ")).toBe("admin");
    await addEntry(db, { email: " Kid@Gmail.com", role: "editor", invitedBy: " Admin@SeattleSolvers.com " });
    const entries = await listEntries(db);
    expect(entries.map((e) => e.email)).toContain("kid@gmail.com");
    expect(entries.find((e) => e.email === "kid@gmail.com")?.invitedBy).toBe("admin@seattlesolvers.com");
  });

  it("unknown email has no role", async () => {
    expect(await getRole(await makeTestDb(), "x@y.com")).toBeNull();
  });

  it("rejects an invalid email", async () => {
    const db = await makeTestDb();
    const err = await addEntry(db, { email: "not-an-email", role: "viewer", invitedBy: SEED_ADMIN_EMAIL }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AllowlistError);
    expect(err).toMatchObject({ code: "INVALID_EMAIL" });
    expect(await listEntries(db)).toEqual([]);
  });

  it("addEntry refuses an email that is already a member and keeps its role", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "viewer", invitedBy: SEED_ADMIN_EMAIL });
    await expect(addEntry(db, { email: " KID@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL }))
      .rejects.toMatchObject({ code: "ALREADY_MEMBER" });
    expect(await getRole(db, "kid@gmail.com")).toBe("viewer");
    await expect(addEntry(db, { email: " Admin@SeattleSolvers.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL }))
      .rejects.toMatchObject({ code: "ALREADY_MEMBER" });
    expect(await getRole(db, SEED_ADMIN_EMAIL)).toBe("admin");
    expect(await listEntries(db)).toHaveLength(2);
  });

  it("cannot demote or remove the last admin", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(setRole(db, SEED_ADMIN_EMAIL, "editor")).rejects.toMatchObject({ code: "LAST_ADMIN" });
    await expect(removeEntry(db, SEED_ADMIN_EMAIL)).rejects.toMatchObject({ code: "LAST_ADMIN" });
    expect(await getRole(db, SEED_ADMIN_EMAIL)).toBe("admin");
    await addEntry(db, { email: "coach@seattlesolvers.com", role: "admin", invitedBy: SEED_ADMIN_EMAIL });
    await expect(setRole(db, SEED_ADMIN_EMAIL, "editor")).resolves.toBeUndefined();
    expect(await getRole(db, SEED_ADMIN_EMAIL)).toBe("editor");
    await expect(removeEntry(db, "coach@seattlesolvers.com")).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  it("setRole and removeEntry on an unknown email do nothing", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await expect(setRole(db, "ghost@gmail.com", "viewer")).resolves.toBeUndefined();
    await expect(removeEntry(db, "ghost@gmail.com")).resolves.toBeUndefined();
    expect(await listEntries(db)).toHaveLength(1);
  });

  it("an admin can be removed while another admin remains", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "coach@seattlesolvers.com", role: "admin", invitedBy: SEED_ADMIN_EMAIL });
    await removeEntry(db, SEED_ADMIN_EMAIL);
    expect(await getRole(db, SEED_ADMIN_EMAIL)).toBeNull();
  });

  it("listEntries is ordered by createdAt then email", async () => {
    const db = await makeTestDb();
    await db.execute(sql`insert into allowlist (email, role, created_at) values
      ('b@x.com','viewer','2024-01-02'), ('z@x.com','viewer','2024-01-01'), ('a@x.com','viewer','2024-01-02')`);
    expect((await listEntries(db)).map((e) => e.email)).toEqual(["z@x.com", "a@x.com", "b@x.com"]);
  });

  it("removeEntry deletes the user's sessions", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await db.insert(user).values([
      { id: "u1", name: "Kid", email: "kid@gmail.com" },
      { id: "u2", name: "Other", email: "other@gmail.com" },
    ]);
    const expiresAt = new Date(Date.now() + 3600_000);
    await db.insert(session).values([
      { id: "s1", userId: "u1", token: "t1", expiresAt, updatedAt: new Date() },
      { id: "s2", userId: "u2", token: "t2", expiresAt, updatedAt: new Date() },
    ]);
    await removeEntry(db, " Kid@Gmail.com ");
    expect(await getRole(db, "kid@gmail.com")).toBeNull();
    expect(await db.select().from(session).where(eq(session.userId, "u1"))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, "u2"))).toHaveLength(1);
    expect(rowsOf(await db.execute(sql`select 1 from "user" where id='u1'`))).toHaveLength(1);
  });
});

describe("removeEntry and Seattle Solvers", () => {
  // With open sign-up on, the member row is the only lock on Seattle Solvers: it must go in the same statement.
  it("removes the person's Seattle Solvers member row itself, and nobody else's", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await addEntry(db, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await addEntry(db, { email: "other@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    await db.insert(user).values([
      { id: "u1", name: "Kid", email: " Kid@Gmail.com " },
      { id: "u2", name: "Other", email: "other@gmail.com" },
    ]);
    await db.execute(sql`insert into organization (id, name, slug, created_at, kind) values ('personal_u1', 'Personal', 'personal_u1', now(), 'personal')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at) values
      ('mt_u1', 'team_seattle_solvers', 'u1', 'editor', now()),
      ('mt_u2', 'team_seattle_solvers', 'u2', 'editor', now()),
      ('mp_u1', 'personal_u1', 'u1', 'admin', now())`);
    const members = async () => rowsOf<{ id: string }>(await db.execute(sql`select id from member order by id`)).map((r) => r.id);

    await removeEntry(db, "kid@gmail.com");
    expect(await members()).toEqual(["mp_u1", "mt_u2"]);
  });

  it("the last admin keeps their member row too", async () => {
    const db = await makeTestDb();
    await seedAdmin(db);
    await db.insert(user).values({ id: "u1", name: "Admin", email: SEED_ADMIN_EMAIL });
    await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at) values ('mt_u1', 'team_seattle_solvers', 'u1', 'admin', now())`);
    await expect(removeEntry(db, SEED_ADMIN_EMAIL)).rejects.toMatchObject({ code: "LAST_ADMIN" });
    expect(rowsOf(await db.execute(sql`select id from member`))).toEqual([{ id: "mt_u1" }]);
  });
});
