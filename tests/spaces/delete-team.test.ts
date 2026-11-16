import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { driveConnection, member, projects, spaceStorage, user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { acceptInvite, findInvite, inviteToTeam } from "@/lib/spaces/invites";
import { actorIn } from "@/lib/spaces/access";
import { makeMemberActions } from "@/lib/spaces/member-actions";
import { deleteTeam } from "@/lib/spaces/members";
import { createTeam, ensurePersonalSpace, listMySpaces } from "@/lib/spaces/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const NAME = "Robotics Club";

async function setup() {
  const db = await makeTestDb();
  for (const [id, name, email] of [
    ["u1", "Uma", "u1@gmail.com"],
    ["u2", "Ben", "u2@gmail.com"],
    ["ada", "Ada", "ada@example.com"],
  ]) {
    await db.insert(user).values({ id, name, email, emailVerified: true });
    await ensurePersonalSpace(db, { id });
  }
  const team = (await createTeam(db, { name: NAME, byUserId: "u1" })).id;
  await joinSpace(db, { id: "u2" }, "editor", team);
  const as = async (id: string, spaceId = team) => (await actorIn(db, testUser({ id }), spaceId)) as Actor;
  return { db, team, as };
}

const err = (code: string, status: number, message: string) => ({ code, status, message });
const addProject = (db: DB, spaceId: string, id: string, deletedAt: Date | null = null) =>
  db.insert(projects).values({ id, spaceId, name: id, format: "landscape", doc: {} as never, createdBy: "u1", updatedBy: "u1", deletedAt } as never);

describe("deleting a team", () => {
  it("an admin deletes an empty team; nobody has it in listMySpaces", async () => {
    const { db, team, as } = await setup();
    expect(await deleteTeam(db, await as("u1"), { confirmName: `  ${NAME} ` })).toEqual({ readerEmail: null });
    for (const id of ["u1", "u2"]) expect((await listMySpaces(db, id)).some((s) => s.id === team)).toBe(false);
    expect(await db.select().from(member).where(eq(member.organizationId, team))).toEqual([]);
  });

  it("deleting a team cancels its invites", async () => {
    const { db, team, as } = await setup();
    const inv = await inviteToTeam(db, await as("u1"), { email: "ada@example.com", role: "editor" });
    await deleteTeam(db, await as("u1"), { confirmName: NAME });
    expect(await findInvite(db, inv.id)).toBeNull();
    await expect(acceptInvite(db, { id: "ada", email: "ada@example.com" }, inv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(team).toBeTruthy();
  });

  it("a team with a live project is refused; one with only deleted projects is allowed", async () => {
    const { db, team, as } = await setup();
    await addProject(db, team, "p_live");
    await expect(deleteTeam(db, await as("u1"), { confirmName: NAME })).rejects.toMatchObject(err("HAS_PROJECTS", 409, "Delete this team's projects first."));
    expect((await listMySpaces(db, "u1")).some((s) => s.id === team)).toBe(true);
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, "p_live"));
    await addProject(db, team, "p_gone", new Date());
    await deleteTeam(db, await as("u1"), { confirmName: NAME });
    expect((await listMySpaces(db, "u1")).some((s) => s.id === team)).toBe(false);
  });

  it("the storage row goes and its reader email is returned; the Drive connection stays", async () => {
    const { db, team, as } = await setup();
    await db.insert(driveConnection).values({ id: "dc_1", userId: "u1", googleSub: "g1", email: "u1.drive@gmail.com", refreshTokenEnc: "sealed", scopes: "drive.file" });
    await db.insert(spaceStorage).values({ spaceId: team, kind: "google_account", connectionId: "dc_1", rootFolderId: "root1", folderName: "EasyEdit – x", readerEmail: "ee-r-abc@proj.iam.gserviceaccount.com", createdBy: "u1" });
    expect(await deleteTeam(db, await as("u1"), { confirmName: NAME })).toEqual({ readerEmail: "ee-r-abc@proj.iam.gserviceaccount.com" });
    expect(await db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, team))).toEqual([]);
    expect(await db.select().from(driveConnection).where(eq(driveConnection.id, "dc_1"))).toHaveLength(1);
  });

  it("editors can't", async () => {
    const { db, team, as } = await setup();
    await expect(deleteTeam(db, await as("u2"), { confirmName: NAME })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect((await listMySpaces(db, "u2")).some((s) => s.id === team)).toBe(true);
  });

  it("Seattle Solvers can't", async () => {
    const { db } = await setup();
    await joinSpace(db, { id: "u1" }, "admin", SEED_TEAM_ID);
    const actor = (await actorIn(db, testUser({ id: "u1" }), SEED_TEAM_ID)) as Actor;
    await expect(deleteTeam(db, actor, { confirmName: "Seattle Solvers" })).rejects.toMatchObject(err("MANAGED_ELSEWHERE", 409, "Seattle Solvers can't be deleted."));
  });

  it("a wrong name is refused, case-sensitively", async () => {
    const { db, team, as } = await setup();
    for (const confirmName of ["", "robotics club", "Robotics"]) {
      await expect(deleteTeam(db, await as("u1"), { confirmName })).rejects.toMatchObject(err("INVALID", 400, "Type the team's name to delete it."));
    }
    expect((await listMySpaces(db, "u1")).some((s) => s.id === team)).toBe(true);
  });
});

class Redirected extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

describe("the deleteTeam action", () => {
  function actionsAs(db: DB, id: string) {
    const deleteReader = vi.fn<(email: string) => Promise<void>>(async () => {});
    const redirect = vi.fn((to: string): never => {
      throw new Redirected(to);
    });
    const signedIn: CurrentUser = { ...testUser({ id }), allowlistRole: null };
    const actions = makeMemberActions({ db: () => db, requireUser: async () => signedIn, revalidate: vi.fn(), redirect, inviteLink: (i) => i, deleteReader });
    return { actions, deleteReader, redirect };
  }
  const form = (confirmName: string) => {
    const data = new FormData();
    data.set("confirmName", confirmName);
    return data;
  };

  it("redirects to /dashboard and calls deleteReader once when there was a reader", async () => {
    const { db, team } = await setup();
    await db.insert(driveConnection).values({ id: "dc_1", userId: "u1", googleSub: "g1", email: "u1.drive@gmail.com", refreshTokenEnc: "sealed", scopes: "drive.file" });
    await db.insert(spaceStorage).values({ spaceId: team, kind: "google_account", connectionId: "dc_1", rootFolderId: "root1", folderName: "x", readerEmail: "ee-r-abc@proj.iam.gserviceaccount.com", createdBy: "u1" });
    const { actions, deleteReader } = actionsAs(db, "u1");
    await expect(actions.deleteTeam(team, form(NAME))).rejects.toMatchObject({ to: "/dashboard" });
    expect(deleteReader).toHaveBeenCalledTimes(1);
    expect(deleteReader).toHaveBeenCalledWith("ee-r-abc@proj.iam.gserviceaccount.com");
  });

  it("redirects without a reader call when there was none, and survives a failing deleteReader", async () => {
    const { db, team } = await setup();
    const a = actionsAs(db, "u1");
    await expect(a.actions.deleteTeam(team, form(NAME))).rejects.toMatchObject({ to: "/dashboard" });
    expect(a.deleteReader).not.toHaveBeenCalled();

    const t2 = await setup();
    await t2.db.insert(driveConnection).values({ id: "dc_1", userId: "u1", googleSub: "g1", email: "u1.drive@gmail.com", refreshTokenEnc: "sealed", scopes: "drive.file" });
    await t2.db.insert(spaceStorage).values({ spaceId: t2.team, kind: "google_account", connectionId: "dc_1", rootFolderId: "r", folderName: "x", readerEmail: "ee-r-x@p.iam.gserviceaccount.com", createdBy: "u1" });
    const b = actionsAs(t2.db, "u1");
    b.deleteReader.mockRejectedValue(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(b.actions.deleteTeam(t2.team, form(NAME))).rejects.toMatchObject({ to: "/dashboard" });
    log.mockRestore();
  });

  it("returns the refusal and doesn't redirect", async () => {
    const { db, team } = await setup();
    const { actions, redirect, deleteReader } = actionsAs(db, "u1");
    expect(await actions.deleteTeam(team, form("nope"))).toEqual({ error: "Type the team's name to delete it." });
    expect(redirect).not.toHaveBeenCalled();
    expect(deleteReader).not.toHaveBeenCalled();
  });
});
