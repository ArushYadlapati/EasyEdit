import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { createTeam, lastSpace, rememberSpace } from "@/lib/spaces/service";
import { canChangeInAnySpace, personalSpaceId, SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";
import { joinSpace } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

describe("the personal spaces switch", () => {
  it("is on only for exactly PERSONAL_SPACES=true", () => {
    expect(personalSpacesOpen({ PERSONAL_SPACES: "true" } as never)).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
      expect(personalSpacesOpen({ PERSONAL_SPACES: value } as never)).toBe(false);
    }
  });
});

describe("whether a person's agents can change anything", () => {
  const personal: MySpace = { id: "personal_u1", slug: "personal_u1", name: "Personal", kind: "personal", role: "admin" };
  const team = (role: MySpace["role"]): MySpace => ({ id: SEED_TEAM_ID, slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role });
  const closed = {} as NodeJS.ProcessEnv;
  const open = { PERSONAL_SPACES: "true" } as never;

  it("closed, a personal space does not count: a viewer of their teams can change nothing", () => {
    expect(canChangeInAnySpace([personal, team("viewer")], closed)).toBe(false);
    expect(canChangeInAnySpace([personal], closed)).toBe(false);
    expect(canChangeInAnySpace([personal, team("editor")], closed)).toBe(true);
    expect(canChangeInAnySpace([personal, team("viewer"), { ...team("admin"), id: "team_apex" }], closed)).toBe(true);
  });

  it("switched on, their own space is enough", () => {
    expect(canChangeInAnySpace([personal, team("viewer")], open)).toBe(true);
    expect(canChangeInAnySpace([team("viewer")], open)).toBe(false);
  });
});

describe("lastSpace while personal spaces are not offered", () => {
  beforeEach(() => void vi.stubEnv("PERSONAL_SPACES", ""));
  afterEach(() => void vi.unstubAllEnvs());

  async function member() {
    const db = await makeTestDb();
    await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
    await joinSpace(db, { id: "u1" }, "admin");
    return db;
  }

  it("a first visit lands in the person's team, not their personal space", async () => {
    const db = await member();
    expect((await lastSpace(db, "u1")).id).toBe(SEED_TEAM_ID);
  });

  it("a remembered personal space is passed over for a team", async () => {
    const db = await member();
    await rememberSpace(db, "u1", personalSpaceId("u1"));
    expect((await lastSpace(db, "u1")).id).toBe(SEED_TEAM_ID);
  });

  it("the team opened last wins over the first by name", async () => {
    const db = await member();
    const apex = await createTeam(db, { name: "Apex", byUserId: "u1" });
    expect((await lastSpace(db, "u1")).id).toBe(apex.id); // first by name
    await rememberSpace(db, "u1", SEED_TEAM_ID);
    expect((await lastSpace(db, "u1")).id).toBe(SEED_TEAM_ID);
  });

  it("someone in no team gets their personal space, whose page says it is coming soon", async () => {
    const db = await makeTestDb();
    await joinSpace(db, { id: "u9" }, "admin", personalSpaceId("u9"));
    expect((await lastSpace(db, "u9")).id).toBe(personalSpaceId("u9"));
  });

  it("switched on, the remembered personal space is where they land", async () => {
    const db = await member();
    await rememberSpace(db, "u1", personalSpaceId("u1"));
    expect((await lastSpace(db, "u1", { PERSONAL_SPACES: "true" } as never)).id).toBe(personalSpaceId("u1"));
  });
});
