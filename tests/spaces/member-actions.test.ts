import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { member, user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { makeMemberActions } from "@/lib/spaces/member-actions";
import { createTeam, ensurePersonalSpace } from "@/lib/spaces/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const FORBIDDEN = "Your role doesn't allow this.";
const SPACE_NOT_FOUND = "Space not found";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT ${to}`);
  }
}

// u1 makes the team (its admin); u2 is an editor in it; u3 is not in it; ada has an account and no team.
async function setup() {
  const db = await makeTestDb();
  for (const [id, name, email] of [
    ["u1", "Uma", "u1@gmail.com"],
    ["u2", "Ben", "u2@gmail.com"],
    ["u3", "Cara", "u3@gmail.com"],
    ["ada", "Ada", "ada@example.com"],
  ]) {
    await db.insert(user).values({ id, name, email, emailVerified: true });
    await ensurePersonalSpace(db, { id });
  }
  const team = (await createTeam(db, { name: "Robotics Club", byUserId: "u1" })).id;
  await joinSpace(db, { id: "u2" }, "editor", team);
  return { db, team };
}

// Someone signed in who isn't on the allowlist: their roles come from their teams only.
const person = (id: string): CurrentUser => ({ ...testUser({ id }), allowlistRole: null });

function actionsAs(db: DB, signedIn: CurrentUser) {
  const revalidate = vi.fn();
  const redirect = vi.fn((to: string): never => {
    throw new Redirected(to);
  });
  const actions = makeMemberActions({ db: () => db, requireUser: async () => signedIn, revalidate, redirect });
  return { actions, revalidate, redirect };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

async function roleOf(db: DB, spaceId: string, userId: string) {
  const rows = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, spaceId), eq(member.userId, userId)));
  return rows[0]?.role ?? null;
}

describe("actions re-check the caller", () => {
  it("an editor's add, setRole and remove return the forbidden message and change nothing", async () => {
    const { db, team } = await setup();
    const { actions, revalidate } = actionsAs(db, person("u2"));
    expect(await actions.add(team, form({ email: "ada@example.com", role: "editor" }))).toEqual({ error: FORBIDDEN });
    expect(await actions.setRole(team, form({ userId: "u1", role: "viewer" }))).toEqual({ error: FORBIDDEN });
    expect(await actions.remove(team, form({ userId: "u1" }))).toEqual({ error: FORBIDDEN });
    expect(await roleOf(db, team, "ada")).toBeNull();
    expect(await roleOf(db, team, "u1")).toBe("admin");
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("a non-member's return the not-found message", async () => {
    const { db, team } = await setup();
    const { actions } = actionsAs(db, person("u3"));
    expect(await actions.add(team, form({ email: "ada@example.com", role: "editor" }))).toEqual({ error: SPACE_NOT_FOUND });
    expect(await actions.setRole(team, form({ userId: "u2", role: "viewer" }))).toEqual({ error: SPACE_NOT_FOUND });
    expect(await actions.remove(team, form({ userId: "u2" }))).toEqual({ error: SPACE_NOT_FOUND });
    expect(await actions.leave(team)).toEqual({ error: SPACE_NOT_FOUND });
    expect(await actions.add("team_nope", form({ email: "ada@example.com", role: "editor" }))).toEqual({ error: SPACE_NOT_FOUND });
    expect(await roleOf(db, team, "ada")).toBeNull();
    expect(await roleOf(db, team, "u2")).toBe("editor");
  });

  it("an admin's add returns ok and the row exists; setRole and remove go through", async () => {
    const { db, team } = await setup();
    const { actions, revalidate } = actionsAs(db, person("u1"));
    expect(await actions.add(team, form({ email: "  Ada@Example.com ", role: "viewer" }))).toEqual({});
    expect(await roleOf(db, team, "ada")).toBe("viewer");
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(await actions.setRole(team, form({ userId: "ada", role: "editor" }))).toEqual({});
    expect(await roleOf(db, team, "ada")).toBe("editor");
    expect(await actions.remove(team, form({ userId: "ada" }))).toEqual({});
    expect(await roleOf(db, team, "ada")).toBeNull();
    expect(revalidate).toHaveBeenCalledTimes(3);
  });

  it("leave redirects to /s/personal", async () => {
    const { db, team } = await setup();
    const { actions, revalidate, redirect } = actionsAs(db, person("u2"));
    await expect(actions.leave(team)).rejects.toMatchObject({ to: "/s/personal" });
    expect(redirect).toHaveBeenCalledWith("/s/personal");
    expect(revalidate).toHaveBeenCalled();
    expect(await roleOf(db, team, "u2")).toBeNull();
  });

  it("a refused leave says why and goes nowhere", async () => {
    const { db, team } = await setup();
    const { actions, redirect } = actionsAs(db, person("u1"));
    expect(await actions.leave(team)).toEqual({ error: "A team needs at least one admin. Make someone else an admin first." });
    expect(redirect).not.toHaveBeenCalled();
    expect(await roleOf(db, team, "u1")).toBe("admin");
  });

  it("a ServiceError's message comes back verbatim", async () => {
    const { db, team } = await setup();
    const { actions } = actionsAs(db, person("u1"));
    expect(await actions.add(team, form({ email: "nobody@example.com", role: "editor" }))).toEqual({
      error: "No EasyEdit account uses that email yet. Ask them to sign in once, then add them.",
    });
    expect(await actions.add(team, form({ email: "u2@gmail.com", role: "editor" }))).toEqual({ error: "They're already in this team." });
    expect(await actions.add(team, form({ email: "ada@example.com", role: "owner" }))).toEqual({ error: "Unknown role." });
    expect(await actions.add(team, new FormData())).toEqual({ error: "Enter an email address." });
    expect(await actions.remove(team, form({ userId: "u1" }))).toEqual({ error: "To leave the team, use Leave team." });
    expect(await actions.remove(team, form({ userId: "u3" }))).toEqual({ error: "They're not in this team." });
  });

  it("Seattle Solvers answers that it is managed on the Admin page", async () => {
    const { db } = await setup();
    await joinSpace(db, { id: "u1" }, "admin");
    const { actions } = actionsAs(db, testUser({ id: "u1" }));
    const managed = { error: "Seattle Solvers' members are managed on the Admin page." };
    expect(await actions.add(SEED_TEAM_ID, form({ email: "ada@example.com", role: "editor" }))).toEqual(managed);
    expect(await actions.leave(SEED_TEAM_ID)).toEqual(managed);
  });
});
