import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { allowlist, member, organization, spaceVisits, user } from "@/db/schema";
import { setRole } from "@/lib/allowlist/service";
import {
  ensurePersonalSpace,
  findMySpace,
  lastSpace,
  listMySpaces,
  rememberSpace,
  roleIn,
  spaceOfAsset,
  spaceOfFolder,
  spaceOfProject,
  syncSeedTeamMembership,
} from "@/lib/spaces/service";
import { createFolder } from "@/lib/projects/folders";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

async function addUser(db: Awaited<ReturnType<typeof makeTestDb>>, id: string) {
  await db.insert(user).values({ id, name: id.toUpperCase(), email: `${id}@gmail.com` });
}
async function addAllow(db: Awaited<ReturnType<typeof makeTestDb>>, id: string, role: "admin" | "editor" | "viewer") {
  await db.insert(allowlist).values({ email: `${id}@gmail.com`, role, invitedBy: null });
}

describe("spaces service", () => {
  it("lists personal first, then teams by name", async () => {
    const db = await makeTestDb();
    await addUser(db, "u1");
    await addAllow(db, "u1", "editor");
    await ensurePersonalSpace(db, { id: "u1" });
    await syncSeedTeamMembership(db, { id: "u1", email: "u1@gmail.com" });
    const spaces = await listMySpaces(db, "u1");
    expect(spaces.map((s) => [s.id, s.role])).toEqual([
      ["personal_u1", "admin"],
      [SEED_TEAM_ID, "editor"],
    ]);
    expect(await roleIn(db, "u1", SEED_TEAM_ID)).toBe("editor");
    expect(await roleIn(db, "u1", "personal_u2")).toBeNull();
  });

  it("findMySpace resolves the personal alias and refuses non-members", async () => {
    const db = await makeTestDb();
    for (const id of ["u1", "u2", "u3"]) await addUser(db, id);
    await addAllow(db, "u1", "editor");
    for (const id of ["u1", "u2", "u3"]) await ensurePersonalSpace(db, { id });
    await syncSeedTeamMembership(db, { id: "u1", email: "u1@gmail.com" });
    expect((await findMySpace(db, "u1", "personal"))?.id).toBe("personal_u1");
    expect((await findMySpace(db, "u1", "seattle-solvers"))?.role).toBe("editor");
    expect(await findMySpace(db, "u3", "seattle-solvers")).toBeNull();
    expect(await findMySpace(db, "u1", "personal_u2")).toBeNull();
  });

  it("ensurePersonalSpace is idempotent", async () => {
    const db = await makeTestDb();
    await addUser(db, "u1");
    await ensurePersonalSpace(db, { id: "u1" });
    await ensurePersonalSpace(db, { id: "u1" });
    expect(await db.select().from(organization).where(eq(organization.id, "personal_u1"))).toHaveLength(1);
    expect(await db.select().from(member).where(eq(member.id, "mp_u1"))).toHaveLength(1);
  });

  it("syncSeedTeamMembership follows the allowlist", async () => {
    const db = await makeTestDb();
    await addUser(db, "u1");
    const roleOf = async () => (await db.select().from(member).where(eq(member.id, "mt_u1")))[0]?.role;
    await addAllow(db, "u1", "editor");
    await syncSeedTeamMembership(db, { id: "u1", email: "U1@gmail.com" });
    expect(await roleOf()).toBe("editor");
    await syncSeedTeamMembership(db, { id: "u1", email: "u1@gmail.com" });
    expect(await db.select().from(member).where(eq(member.id, "mt_u1"))).toHaveLength(1);
    await setRole(db, "u1@gmail.com", "viewer");
    await syncSeedTeamMembership(db, { id: "u1", email: "u1@gmail.com" });
    expect(await roleOf()).toBe("viewer");
    await db.delete(allowlist).where(eq(allowlist.email, "u1@gmail.com"));
    await syncSeedTeamMembership(db, { id: "u1", email: "u1@gmail.com" });
    expect(await roleOf()).toBeUndefined();
  });

  it("lastSpace falls back to personal when the remembered space is gone", async () => {
    const db = await makeTestDb();
    await addUser(db, "u1");
    await addAllow(db, "u1", "editor");
    await ensurePersonalSpace(db, { id: "u1" });
    expect((await lastSpace(db, "u1")).id).toBe("personal_u1");
    await syncSeedTeamMembership(db, { id: "u1", email: "u1@gmail.com" });
    await rememberSpace(db, "u1", SEED_TEAM_ID);
    await rememberSpace(db, "u1", SEED_TEAM_ID);
    expect((await lastSpace(db, "u1")).id).toBe(SEED_TEAM_ID);
    await db.delete(allowlist).where(eq(allowlist.email, "u1@gmail.com"));
    await syncSeedTeamMembership(db, { id: "u1", email: "u1@gmail.com" });
    expect((await lastSpace(db, "u1")).id).toBe("personal_u1");
    expect(await db.select().from(spaceVisits)).toHaveLength(1);
  });

  it("spaceOfProject ignores deleted projects", async () => {
    const db = await makeTestDb();
    await addUser(db, "u1");
    await ensurePersonalSpace(db, { id: "u1" });
    await db.execute(sql`insert into projects (id, space_id, name, format, doc, created_by, updated_by) values ('p1', 'personal_u1', 'A', 'x', '{}'::jsonb, 'u1', 'u1')`);
    await db.execute(sql`insert into projects (id, space_id, name, format, doc, created_by, updated_by, deleted_at) values ('p2', 'personal_u1', 'B', 'x', '{}'::jsonb, 'u1', 'u1', now())`);
    expect(await spaceOfProject(db, "p1")).toBe("personal_u1");
    expect(await spaceOfProject(db, "p2")).toBeNull();
    expect(await spaceOfProject(db, "nope")).toBeNull();
    expect(await spaceOfAsset(db, "nope")).toBeNull();
  });

  it("spaceOfFolder names the space a folder is in, or null for an unknown one", async () => {
    const db = await makeTestDb();
    await addUser(db, "u1");
    const folder = await createFolder(db, testActor({ userId: "u1" }), "Season");
    expect(await spaceOfFolder(db, folder.id)).toBe(SEED_TEAM_ID);
    expect(await spaceOfFolder(db, "nope")).toBeNull();
  });
});
