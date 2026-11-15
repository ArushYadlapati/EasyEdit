import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { allowlist, user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { actorIn, assetActor, projectActor, spaceQuery } from "@/lib/spaces/access";
import { ensurePersonalSpace, syncSeedTeamMembership } from "@/lib/spaces/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { makeTestDb } from "../helpers/db";

type DB = Awaited<ReturnType<typeof makeTestDb>>;

const signedIn = (id: string): CurrentUser => ({ id, email: `${id}@gmail.com`, name: id.toUpperCase(), image: null, allowlistRole: "admin" });

async function addMember(db: DB, id: string, role: "admin" | "editor" | "viewer") {
  await db.insert(user).values({ id, name: id.toUpperCase(), email: `${id}@gmail.com` });
  await db.insert(allowlist).values({ email: `${id}@gmail.com`, role, invitedBy: null });
  await ensurePersonalSpace(db, { id });
  await syncSeedTeamMembership(db, { id, email: `${id}@gmail.com` });
}

async function addProject(db: DB, id: string, spaceId: string, deleted = false) {
  await db.execute(sql`
    insert into projects (id, space_id, name, format, doc, created_by, updated_by, deleted_at)
    values (${id}, ${spaceId}, 'A', 'x', '{}'::jsonb, 'u1', 'u1', ${deleted ? sql`now()` : null})
  `);
}

describe("actorIn", () => {
  it("carries the member's role in that space and the space id", async () => {
    const db = await makeTestDb();
    await addMember(db, "u1", "editor");
    const user1 = signedIn("u1");
    expect(await actorIn(db, user1, SEED_TEAM_ID)).toEqual({ userId: "u1", email: "u1@gmail.com", role: "editor", spaceId: SEED_TEAM_ID });
    // Admin of their own personal space, whatever the allowlist says.
    expect(await actorIn(db, user1, "personal_u1")).toEqual({ userId: "u1", email: "u1@gmail.com", role: "admin", spaceId: "personal_u1" });
  });

  it("is null for a space the user is not a member of", async () => {
    const db = await makeTestDb();
    await addMember(db, "u1", "editor");
    await addMember(db, "u2", "editor");
    expect(await actorIn(db, signedIn("u1"), "personal_u2")).toBeNull();
    expect(await actorIn(db, signedIn("u1"), "nope")).toBeNull();
    expect(await actorIn(db, signedIn("u3"), SEED_TEAM_ID)).toBeNull();
  });
});

describe("projectActor", () => {
  it("acts in the project's own space", async () => {
    const db = await makeTestDb();
    await addMember(db, "u1", "viewer");
    await addProject(db, "p1", SEED_TEAM_ID);
    await addProject(db, "p2", "personal_u1");
    expect(await projectActor(db, signedIn("u1"), "p1")).toMatchObject({ role: "viewer", spaceId: SEED_TEAM_ID });
    expect(await projectActor(db, signedIn("u1"), "p2")).toMatchObject({ role: "admin", spaceId: "personal_u1" });
  });

  it("is null for a deleted project, an unknown one, and one in a space the user is not in", async () => {
    const db = await makeTestDb();
    await addMember(db, "u1", "admin");
    await addMember(db, "u2", "admin");
    await addProject(db, "gone", SEED_TEAM_ID, true);
    await addProject(db, "theirs", "personal_u2");
    expect(await projectActor(db, signedIn("u1"), "gone")).toBeNull();
    expect(await projectActor(db, signedIn("u1"), "nope")).toBeNull();
    expect(await projectActor(db, signedIn("u1"), "theirs")).toBeNull();
  });
});

describe("assetActor", () => {
  it("is null for an unknown asset", async () => {
    const db = await makeTestDb();
    await addMember(db, "u1", "admin");
    expect(await assetActor(db, signedIn("u1"), "nope")).toBeNull();
  });
});

describe("spaceQuery", () => {
  it("reads ?space=", () => {
    expect(spaceQuery(new Request("http://x/api/projects?space=personal_u1"))).toBe("personal_u1");
    expect(spaceQuery(new Request("http://x/api/projects"))).toBeNull();
    expect(spaceQuery(new Request("http://x/api/projects?space="))).toBeNull();
  });
});
