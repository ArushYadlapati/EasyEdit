import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { organization, user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { actorIn } from "@/lib/spaces/access";
import { makeMemberActions } from "@/lib/spaces/member-actions";
import { renameTeam } from "@/lib/spaces/members";
import { createTeam, ensurePersonalSpace } from "@/lib/spaces/service";
import { SEED_TEAM_ID, personalSpaceId } from "@/lib/spaces/types";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

async function setup() {
  const db = await makeTestDb();
  for (const [id, name, email] of [
    ["u1", "Uma", "u1@gmail.com"],
    ["u2", "Ben", "u2@gmail.com"],
  ]) {
    await db.insert(user).values({ id, name, email, emailVerified: true });
    await ensurePersonalSpace(db, { id });
  }
  const created = await createTeam(db, { name: "Robotics Club", byUserId: "u1" });
  await joinSpace(db, { id: "u2" }, "editor", created.id);
  const as = async (id: string, spaceId = created.id) => (await actorIn(db, testUser({ id }), spaceId)) as Actor;
  const row = async () => (await db.select().from(organization).where(eq(organization.id, created.id)))[0]!;
  return { db, team: created.id, slug: created.slug, as, row };
}

const INVALID = `Give the team a name of up to ${LIMITS.teamNameChars} characters.`;
const PERSONAL = 'Pick a different name. "Personal" is your own space.';

describe("renaming a team", () => {
  it("an admin renames it; the slug stays", async () => {
    const { db, as, row, slug } = await setup();
    expect(await renameTeam(db, await as("u1"), "Robots United")).toEqual({ name: "Robots United" });
    const r = await row();
    expect(r.name).toBe("Robots United");
    expect(r.slug).toBe(slug);
  });

  it("cleans the name like createTeam", async () => {
    const { db, as, row } = await setup();
    expect(await renameTeam(db, await as("u1"), "  Robo​ts \n\t United‮ ")).toEqual({ name: "Robots United" });
    expect((await row()).name).toBe("Robots United");
  });

  it("refuses an empty, too long or Personal name with createTeam's messages", async () => {
    const { db, as, row } = await setup();
    for (const [name, message] of [
      ["", INVALID],
      [" ​ ", INVALID],
      ["x".repeat(LIMITS.teamNameChars + 1), INVALID],
      [" personal ", PERSONAL],
    ] as const) {
      await expect(renameTeam(db, await as("u1"), name)).rejects.toMatchObject({ code: "INVALID", status: 400, message });
    }
    expect((await row()).name).toBe("Robotics Club");
  });

  it("an editor can't", async () => {
    const { db, as, row } = await setup();
    await expect(renameTeam(db, await as("u2"), "Nope")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect((await row()).name).toBe("Robotics Club");
  });

  it("Seattle Solvers can't", async () => {
    const { db } = await setup();
    await joinSpace(db, { id: "u1" }, "admin", SEED_TEAM_ID);
    const actor = (await actorIn(db, testUser({ id: "u1" }), SEED_TEAM_ID)) as Actor;
    await expect(renameTeam(db, actor, "Other")).rejects.toMatchObject({ code: "MANAGED_ELSEWHERE", status: 409 });
  });

  it("a personal space can't", async () => {
    const { db, as } = await setup();
    await expect(renameTeam(db, await as("u1", personalSpaceId("u1")), "Mine")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("the rename action", () => {
  it("renames and revalidates; returns the refusal otherwise", async () => {
    const { db, team, row } = await setup();
    const revalidate = vi.fn();
    const signedIn: CurrentUser = { ...testUser({ id: "u1" }), allowlistRole: null };
    const actions = makeMemberActions({ db: () => db, requireUser: async () => signedIn, revalidate, redirect: (p) => { throw new Error(p); }, inviteLink: (i) => i });
    const form = (name: string) => {
      const data = new FormData();
      data.set("name", name);
      return data;
    };
    expect(await actions.rename(team, form(" Robots   United "))).toEqual({ name: "Robots United" });
    expect((await row()).name).toBe("Robots United");
    expect(revalidate).toHaveBeenCalled();
    expect(await actions.rename(team, form("Personal"))).toEqual({ error: PERSONAL });
  });
});
