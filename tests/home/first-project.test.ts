import { describe, expect, it, vi } from "vitest";
import { user as userTable } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { draftFormData, parseDraft, UNTITLED } from "@/lib/home/first-project";
import { loginHref, safeNext } from "@/lib/home/safe-next";
import { listProjects } from "@/lib/projects/service";
import { NOWHERE_TO_START, startProject, startSpace } from "@/lib/projects/start-project";
import { PERSONAL_SOON } from "@/lib/spaces/personal";
import { rememberSpace } from "@/lib/spaces/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

describe("where sign-in may send a person next", () => {
  it("takes a path on this site, with its query and hash", () => {
    expect(safeNext("/new")).toBe("/new");
    expect(safeNext(["/s/personal?folder=f1#x", "/other"])).toBe("/s/personal?folder=f1#x");
    expect(safeNext("/a/../new")).toBe("/new");
  });

  it("refuses another site, however it is written", () => {
    for (const bad of [
      "https://evil.example/new",
      "//evil.example/new",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      " /new",
      "javascript:alert(1)",
      "new",
      "",
      "/" + "a".repeat(600),
    ]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(null)).toBeNull();
  });

  it("refuses the sign-in page itself and the sign-in server's API", () => {
    expect(safeNext("/login?next=/new")).toBeNull();
    expect(safeNext("/api/auth/sign-out")).toBeNull();
  });

  it("carries next on in the sign-in page's address", () => {
    expect(loginHref("/new")).toBe("/login?next=%2Fnew");
    expect(loginHref(null)).toBe("/login");
  });
});

describe("the home page's project, kept in the tab", () => {
  const kept = { name: "Beach day recap", format: "long_16x9", width: "1080", height: "1080", asked: true };

  it("reads back what the form wrote", () => {
    expect(parseDraft(JSON.stringify(kept))).toEqual(kept);
    expect(parseDraft(JSON.stringify({ ...kept, asked: "yes" }))?.asked).toBe(false);
  });

  it("is nothing when it is not one", () => {
    for (const raw of [null, "", "{", "null", "[]", JSON.stringify({ ...kept, format: "nope" })]) {
      expect(parseDraft(raw), String(raw)).toBeNull();
    }
    expect(parseDraft(JSON.stringify({ ...kept, name: "x".repeat(101) }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...kept, width: "1e9" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...kept, name: 7 }))).toBeNull();
  });

  it("sends the dashboard's fields, a size only with the custom format and an empty name as Untitled project", () => {
    const named = draftFormData({ ...kept, asked: true });
    expect([...named.entries()]).toEqual([
      ["name", "Beach day recap"],
      ["format", "long_16x9"],
    ]);
    const custom = draftFormData({ name: "  ", format: "custom", width: "1200", height: "800", asked: true });
    expect(Object.fromEntries(custom.entries())).toEqual({ name: UNTITLED, format: "custom", width: "1200", height: "800" });
  });
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function setup(user: CurrentUser = testUser({ id: "new1" })) {
  const db = await makeTestDb();
  const redirect = vi.fn((path: string): never => {
    throw new Error(`REDIRECT ${path}`);
  });
  const deps = { db: () => db, requireUser: async () => user, revalidate: vi.fn(), redirect };
  return { db, user, deps };
}

describe("making the project the home page asked for", () => {
  it("makes a new account's project in its Personal space and opens it in the editor", async () => {
    const { db, user, deps } = await setup();
    await joinSpace(db, user, "admin", personalSpaceId(user.id));
    await expect(startProject(deps, form({ name: "Beach day recap", format: "long_16x9" }))).rejects.toThrow(
      /^REDIRECT \/s\/personal\/editor\/\S+$/,
    );
    const [made] = await listProjects(db, testActor({ userId: user.id, email: user.email, spaceId: personalSpaceId(user.id), role: "admin" }));
    expect([made.name, made.format]).toEqual(["Beach day recap", "long_16x9"]);
  });

  it("makes its Personal space first when sign-in has not yet", async () => {
    const { db, user, deps } = await setup(testUser({ id: "fresh" }));
    await db.insert(userTable).values({ id: "fresh", name: "Fresh", email: "fresh@gmail.com", emailVerified: true });
    expect((await startSpace(db, user))?.id).toBe(personalSpaceId(user.id));
    await expect(startProject(deps, form({ name: "Mine", format: "square_1x1" }))).rejects.toThrow(/^REDIRECT \/s\/personal\/editor\//);
  });

  it("goes in the space the person used last, like the dashboard", async () => {
    const { db, user, deps } = await setup();
    await joinSpace(db, user, "editor");
    await rememberSpace(db, user.id, SEED_TEAM_ID);
    await expect(startProject(deps, form({ name: "Team cut", format: "short_9x16" }))).rejects.toThrow(
      /^REDIRECT \/s\/seattle-solvers\/editor\//,
    );
  });

  it("goes in Personal when the space used last is one the person only views", async () => {
    const { db, user } = await setup();
    await joinSpace(db, user, "viewer");
    await rememberSpace(db, user.id, SEED_TEAM_ID);
    expect((await startSpace(db, user))?.id).toBe(personalSpaceId(user.id));
  });

  it("says why when there is nowhere to make it, and makes nothing", async () => {
    const { db, user, deps } = await setup();
    await joinSpace(db, user, "viewer");
    await rememberSpace(db, user.id, SEED_TEAM_ID);
    const closed = { ...process.env, PERSONAL_SPACES: "" };
    expect(await startSpace(db, user, closed)).toBeNull();
    expect(await startProject(deps, form({ name: "X", format: "short_9x16" }), closed)).toEqual({ error: PERSONAL_SOON.noTeam });
    // With personal spaces open everyone has one they edit in, so this one is only for old viewer rows.
    expect(NOWHERE_TO_START).toMatch(/^You can only view/);
  });

  it("checks the name and format as the dashboard does", async () => {
    const { db, user, deps } = await setup();
    await joinSpace(db, user, "admin", personalSpaceId(user.id));
    expect(await startProject(deps, form({ name: "x".repeat(101), format: "short_9x16" }))).toEqual({
      error: "Enter a name up to 100 characters.",
    });
    expect(await startProject(deps, form({ name: "Ok", format: "custom", width: "5", height: "5" }))).toHaveProperty("error");
  });
});
