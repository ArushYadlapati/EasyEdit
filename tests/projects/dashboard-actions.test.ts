import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import type { Role } from "@/lib/allowlist/service";
import { makeDashboardActions } from "@/lib/projects/dashboard-actions";
import { createFolder, deleteFolder, listFolders } from "@/lib/projects/folders";
import { listPinnedIds } from "@/lib/projects/pins";
import { createProject, deleteProject, getProject, listProjects } from "@/lib/projects/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };

async function setup(role: Role = "editor") {
  const db = await makeTestDb();
  const user: CurrentUser = testUser({ allowlistRole: role });
  await joinSpace(db, user, role);
  const revalidate = vi.fn();
  const redirect = vi.fn((path: string): never => { throw new Error(`REDIRECT ${path}`); });
  const actions = makeDashboardActions({ db: () => db, requireUser: async () => user, revalidate, redirect });
  const owner = testActor({ role: "editor" });
  return { db, owner, revalidate, actions };
}

describe("dashboard actions", () => {
  it("create explains a bad name or format and creates nothing", async () => {
    const { db, owner, actions } = await setup();
    for (const name of ["", "   ", "x".repeat(101)]) {
      expect(await actions.create(SEED_TEAM_ID, {}, form({ name, format: "short_9x16" }))).toEqual({ error: "Enter a name up to 100 characters." });
    }
    expect(await actions.create(SEED_TEAM_ID, {}, form({ name: "Qual", format: "nope" }))).toEqual({ error: "Pick a format." });
    expect(await listProjects(db, owner)).toEqual([]);
  });

  it("create opens the new project in the editor", async () => {
    const { actions } = await setup();
    await expect(actions.create(SEED_TEAM_ID, {}, form({ name: "Qual", format: "short_9x16" }))).rejects.toThrow(/^REDIRECT \/s\/seattle-solvers\/editor\/\S+$/);
  });

  it("create from a template ignores the format and starts from the template", async () => {
    const { db, owner, actions } = await setup();
    await expect(actions.create(SEED_TEAM_ID, {}, form({ name: "Recap", templateId: "starter-match-recap", format: "nope" }))).rejects.toThrow(/^REDIRECT /);
    const [created] = await listProjects(db, owner);
    expect(created.name).toBe("Recap");
    expect(await actions.create(SEED_TEAM_ID, {}, form({ name: "X", templateId: "missing" }))).toEqual({ error: "Template not found" });
  });

  it("rename, duplicate and delete change the project and refresh the dashboard", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    expect(await actions.rename(SEED_TEAM_ID, form({ id, name: "Finals" }))).toEqual({});
    expect(await actions.duplicate(SEED_TEAM_ID, form({ id }))).toEqual({});
    expect((await listProjects(db, owner)).map((p) => p.name).sort()).toEqual(["Finals", "Finals copy"]);
    expect(await actions.remove(SEED_TEAM_ID, form({ id }))).toEqual({});
    expect(await getProject(db, owner, id)).toBeNull();
    expect(revalidate).toHaveBeenCalledTimes(3);
    expect(revalidate).toHaveBeenCalledWith("/s/[space]");
  });

  it("pin and unpin change the space's pins and refresh the dashboard; a viewer can't", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    expect(await actions.pin(SEED_TEAM_ID, form({ id }))).toEqual({});
    expect(await listPinnedIds(db, owner)).toEqual([id]);
    expect(await actions.unpin(SEED_TEAM_ID, form({ id }))).toEqual({});
    expect(await listPinnedIds(db, owner)).toEqual([]);
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(await actions.pin(SEED_TEAM_ID, form({ id: "gone" }))).toEqual({ error: "That project no longer exists." });
    const viewer = await setup("viewer");
    const other = await createProject(viewer.db, viewer.owner, { name: "Qual", format: "short_9x16" });
    expect(await viewer.actions.pin(SEED_TEAM_ID, form({ id: other.id }))).toEqual({ error: "Your role doesn't allow this." });
    expect(await listPinnedIds(viewer.db, viewer.owner)).toEqual([]);
  });

  it("a viewer gets the role message and nothing changes", async () => {
    const { db, owner, revalidate, actions } = await setup("viewer");
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    for (const result of [await actions.rename(SEED_TEAM_ID, form({ id, name: "X" })), await actions.duplicate(SEED_TEAM_ID, form({ id })), await actions.remove(SEED_TEAM_ID, form({ id }))]) {
      expect(result).toEqual({ error: "Your role doesn't allow this." });
    }
    expect(await actions.create(SEED_TEAM_ID, {}, form({ name: "New", format: "short_9x16" }))).toEqual({ error: "Your role doesn't allow this." });
    expect((await listProjects(db, owner)).map((p) => p.name)).toEqual(["Qual"]);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("someone who is not a member of the space changes nothing", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    await db.execute(sql`delete from member where id = 'mt_u1'`);
    expect(await actions.rename(SEED_TEAM_ID, form({ id, name: "X" }))).toEqual({ error: "You're not a member of this space." });
    expect(await actions.createFolder(SEED_TEAM_ID, form({ name: "Season" }))).toEqual({ error: "You're not a member of this space." });
    expect((await getProject(db, owner, id))!.name).toBe("Qual");
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("acting on a deleted project says it no longer exists and refreshes the dashboard, so its card goes", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    await deleteProject(db, owner, id); // deleted elsewhere, for example in another tab
    for (const act of [() => actions.rename(SEED_TEAM_ID, form({ id, name: "X" })), () => actions.duplicate(SEED_TEAM_ID, form({ id })), () => actions.remove(SEED_TEAM_ID, form({ id }))]) {
      revalidate.mockClear();
      expect(await act()).toEqual({ error: "That project no longer exists." });
      expect(revalidate).toHaveBeenCalledWith("/s/[space]");
    }
  });
  it("create makes a custom size in the folder chosen", async () => {
    const { db, owner, actions } = await setup();
    const f = await createFolder(db, owner, "Season 2026");
    await expect(
      actions.create(SEED_TEAM_ID, {}, form({ name: "Poster", format: "custom", width: "816", height: "1056", folderId: f.id })),
    ).rejects.toThrow(/^REDIRECT \/s\/seattle-solvers\/editor\/\S+$/);
    const [row] = await listProjects(db, owner);
    expect(row).toMatchObject({ format: "custom", width: 816, height: 1056, folderId: f.id });
  });

  it("create explains a size outside the limits", async () => {
    const { db, owner, actions } = await setup();
    for (const [width, height] of [["5000", "100"], ["abc", "100"]]) {
      expect(await actions.create(SEED_TEAM_ID, {}, form({ name: "Poster", format: "custom", width, height }))).toEqual({
        error: "Width and height go from 16 to 4096 pixels, up to the area of 4K (3840 × 2160).",
      });
    }
    expect(await listProjects(db, owner)).toEqual([]);
  });

  it("folder actions change folders and refresh the dashboard", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id: project } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    expect(await actions.createFolder(SEED_TEAM_ID, form({ name: "Season 2026" }))).toEqual({});
    const [f] = await listFolders(db, owner);
    expect(f).toMatchObject({ name: "Season 2026" });
    expect(await actions.renameFolder(SEED_TEAM_ID, form({ id: f.id, name: "Sponsors" }))).toEqual({});
    expect(await actions.move(SEED_TEAM_ID, form({ id: project, folderId: f.id }))).toEqual({});
    expect((await listFolders(db, owner))[0]).toMatchObject({ id: f.id, name: "Sponsors", projectCount: 1 });
    expect(await actions.move(SEED_TEAM_ID, form({ id: project, folderId: "" }))).toEqual({});
    expect((await listFolders(db, owner))[0]).toMatchObject({ id: f.id, projectCount: 0 });
    expect(await actions.deleteFolder(SEED_TEAM_ID, form({ id: f.id }))).toEqual({});
    expect(revalidate).toHaveBeenCalledTimes(5);
    for (const call of revalidate.mock.calls) expect(call).toEqual(["/s/[space]"]);
    expect(await listFolders(db, owner)).toEqual([]);
    expect((await listProjects(db, owner))[0]).toMatchObject({ id: project, folderId: null });
  });

  it("a taken or bad folder name is explained", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const f = await createFolder(db, owner, "Season 2026");
    expect(await actions.createFolder(SEED_TEAM_ID, form({ name: "season 2026" }))).toEqual({ error: "There's already a folder with that name." });
    const other = await createFolder(db, owner, "Sponsors");
    expect(await actions.renameFolder(SEED_TEAM_ID, form({ id: other.id, name: " SEASON 2026 " }))).toEqual({ error: "There's already a folder with that name." });
    for (const name of ["", "   ", "x".repeat(61)]) {
      expect(await actions.createFolder(SEED_TEAM_ID, form({ name }))).toEqual({ error: "Enter a folder name up to 60 characters." });
      expect(await actions.renameFolder(SEED_TEAM_ID, form({ id: f.id, name }))).toEqual({ error: "Enter a folder name up to 60 characters." });
    }
    expect((await listFolders(db, owner)).map((x) => x.name)).toEqual(["Season 2026", "Sponsors"]);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("acting on a folder deleted elsewhere says so and refreshes the dashboard", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id: project } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    const f = await createFolder(db, owner, "Season 2026");
    await deleteFolder(db, owner, f.id); // deleted elsewhere, for example in another tab
    for (const act of [
      () => actions.renameFolder(SEED_TEAM_ID, form({ id: f.id, name: "Sponsors" })),
      () => actions.deleteFolder(SEED_TEAM_ID, form({ id: f.id })),
      () => actions.move(SEED_TEAM_ID, form({ id: project, folderId: f.id })),
    ]) {
      revalidate.mockClear();
      expect(await act()).toEqual({ error: "That folder no longer exists." });
      expect(revalidate).toHaveBeenCalledWith("/s/[space]");
    }
    const { id: gone } = await createProject(db, owner, { name: "Old", format: "short_9x16" });
    await deleteProject(db, owner, gone);
    revalidate.mockClear();
    expect(await actions.move(SEED_TEAM_ID, form({ id: gone, folderId: "" }))).toEqual({ error: "That project no longer exists." });
    expect(revalidate).toHaveBeenCalledWith("/s/[space]");
  });

  it("an empty width or height means none", async () => {
    const { actions } = await setup();
    await expect(
      actions.create(SEED_TEAM_ID, {}, form({ name: "Qual", format: "short_9x16", width: "", height: "" })),
    ).rejects.toThrow(/^REDIRECT \/s\/seattle-solvers\/editor\/\S+$/);
  });

  it("a viewer gets the role message from every folder action", async () => {
    const { db, owner, revalidate, actions } = await setup("viewer");
    const { id: project } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    const f = await createFolder(db, owner, "Season 2026");
    for (const result of [
      await actions.createFolder(SEED_TEAM_ID, form({ name: "Sponsors" })),
      await actions.renameFolder(SEED_TEAM_ID, form({ id: f.id, name: "Sponsors" })),
      await actions.deleteFolder(SEED_TEAM_ID, form({ id: f.id })),
      await actions.move(SEED_TEAM_ID, form({ id: project, folderId: f.id })),
    ]) {
      expect(result).toEqual({ error: "Your role doesn't allow this." });
    }
    expect(await listFolders(db, owner)).toEqual([{ id: f.id, name: "Season 2026", projectCount: 0 }]);
    expect((await listProjects(db, owner))[0]).toMatchObject({ folderId: null });
    expect(revalidate).not.toHaveBeenCalled();
  });
});
