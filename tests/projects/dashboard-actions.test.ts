import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { actorFrom } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { makeDashboardActions } from "@/lib/projects/dashboard-actions";
import { createFolder, deleteFolder, listFolders } from "@/lib/projects/folders";
import { createProject, deleteProject, getProject, listProjects } from "@/lib/projects/service";
import { makeTestDb } from "../helpers/db";

const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };

async function setup(role: Role = "editor") {
  const db = await makeTestDb();
  const user: CurrentUser = { id: "u1", email: "u1@gmail.com", name: "U1", image: null, role };
  const revalidate = vi.fn();
  const redirect = vi.fn((path: string): never => { throw new Error(`REDIRECT ${path}`); });
  const actions = makeDashboardActions({ db: () => db, requireUser: async () => user, revalidate, redirect });
  const owner = actorFrom({ ...user, role: "editor" });
  return { db, owner, revalidate, actions };
}

describe("dashboard actions", () => {
  it("create explains a bad name or format and creates nothing", async () => {
    const { db, owner, actions } = await setup();
    for (const name of ["", "   ", "x".repeat(101)]) {
      expect(await actions.create({}, form({ name, format: "short_9x16" }))).toEqual({ error: "Enter a name up to 100 characters." });
    }
    expect(await actions.create({}, form({ name: "Qual", format: "nope" }))).toEqual({ error: "Pick a format." });
    expect(await listProjects(db, owner)).toEqual([]);
  });

  it("create opens the new project in the editor", async () => {
    const { actions } = await setup();
    await expect(actions.create({}, form({ name: "Qual", format: "short_9x16" }))).rejects.toThrow(/^REDIRECT \/editor\/\S+$/);
  });

  it("rename, duplicate and delete change the project and refresh the dashboard", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    expect(await actions.rename(form({ id, name: "Finals" }))).toEqual({});
    expect(await actions.duplicate(form({ id }))).toEqual({});
    expect((await listProjects(db, owner)).map((p) => p.name).sort()).toEqual(["Finals", "Finals copy"]);
    expect(await actions.remove(form({ id }))).toEqual({});
    expect(await getProject(db, owner, id)).toBeNull();
    expect(revalidate).toHaveBeenCalledTimes(3);
    expect(revalidate).toHaveBeenCalledWith("/dashboard");
  });

  it("a viewer gets the role message and nothing changes", async () => {
    const { db, owner, revalidate, actions } = await setup("viewer");
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    for (const result of [await actions.rename(form({ id, name: "X" })), await actions.duplicate(form({ id })), await actions.remove(form({ id }))]) {
      expect(result).toEqual({ error: "Your role doesn't allow this." });
    }
    expect(await actions.create({}, form({ name: "New", format: "short_9x16" }))).toEqual({ error: "Your role doesn't allow this." });
    expect((await listProjects(db, owner)).map((p) => p.name)).toEqual(["Qual"]);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("acting on a deleted project says it no longer exists and refreshes the dashboard, so its card goes", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    await deleteProject(db, owner, id); // deleted elsewhere, for example in another tab
    for (const act of [() => actions.rename(form({ id, name: "X" })), () => actions.duplicate(form({ id })), () => actions.remove(form({ id }))]) {
      revalidate.mockClear();
      expect(await act()).toEqual({ error: "That project no longer exists." });
      expect(revalidate).toHaveBeenCalledWith("/dashboard");
    }
  });
  it("create makes a custom size in the folder chosen", async () => {
    const { db, owner, actions } = await setup();
    const f = await createFolder(db, owner, "Season 2026");
    await expect(
      actions.create({}, form({ name: "Poster", format: "custom", width: "816", height: "1056", folderId: f.id })),
    ).rejects.toThrow(/^REDIRECT \/editor\/\S+$/);
    const [row] = await listProjects(db, owner);
    expect(row).toMatchObject({ format: "custom", width: 816, height: 1056, folderId: f.id });
  });

  it("create explains a size outside the limits", async () => {
    const { db, owner, actions } = await setup();
    for (const [width, height] of [["5000", "100"], ["abc", "100"]]) {
      expect(await actions.create({}, form({ name: "Poster", format: "custom", width, height }))).toEqual({
        error: "Width and height go from 16 to 4096 pixels, up to the area of 4K (3840 × 2160).",
      });
    }
    expect(await listProjects(db, owner)).toEqual([]);
  });

  it("folder actions change folders and refresh the dashboard", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const { id: project } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    expect(await actions.createFolder(form({ name: "Season 2026" }))).toEqual({});
    const [f] = await listFolders(db, owner);
    expect(f).toMatchObject({ name: "Season 2026" });
    expect(await actions.renameFolder(form({ id: f.id, name: "Sponsors" }))).toEqual({});
    expect(await actions.move(form({ id: project, folderId: f.id }))).toEqual({});
    expect((await listFolders(db, owner))[0]).toMatchObject({ id: f.id, name: "Sponsors", projectCount: 1 });
    expect(await actions.move(form({ id: project, folderId: "" }))).toEqual({});
    expect((await listFolders(db, owner))[0]).toMatchObject({ id: f.id, projectCount: 0 });
    expect(await actions.deleteFolder(form({ id: f.id }))).toEqual({});
    expect(revalidate).toHaveBeenCalledTimes(5);
    for (const call of revalidate.mock.calls) expect(call).toEqual(["/dashboard"]);
    expect(await listFolders(db, owner)).toEqual([]);
    expect((await listProjects(db, owner))[0]).toMatchObject({ id: project, folderId: null });
  });

  it("a taken or bad folder name is explained", async () => {
    const { db, owner, revalidate, actions } = await setup();
    const f = await createFolder(db, owner, "Season 2026");
    expect(await actions.createFolder(form({ name: "season 2026" }))).toEqual({ error: "There's already a folder with that name." });
    const other = await createFolder(db, owner, "Sponsors");
    expect(await actions.renameFolder(form({ id: other.id, name: " SEASON 2026 " }))).toEqual({ error: "There's already a folder with that name." });
    for (const name of ["", "   ", "x".repeat(61)]) {
      expect(await actions.createFolder(form({ name }))).toEqual({ error: "Enter a folder name up to 60 characters." });
      expect(await actions.renameFolder(form({ id: f.id, name }))).toEqual({ error: "Enter a folder name up to 60 characters." });
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
      () => actions.renameFolder(form({ id: f.id, name: "Sponsors" })),
      () => actions.deleteFolder(form({ id: f.id })),
      () => actions.move(form({ id: project, folderId: f.id })),
    ]) {
      revalidate.mockClear();
      expect(await act()).toEqual({ error: "That folder no longer exists." });
      expect(revalidate).toHaveBeenCalledWith("/dashboard");
    }
    const { id: gone } = await createProject(db, owner, { name: "Old", format: "short_9x16" });
    await deleteProject(db, owner, gone);
    revalidate.mockClear();
    expect(await actions.move(form({ id: gone, folderId: "" }))).toEqual({ error: "That project no longer exists." });
    expect(revalidate).toHaveBeenCalledWith("/dashboard");
  });

  it("an empty width or height means none", async () => {
    const { actions } = await setup();
    await expect(
      actions.create({}, form({ name: "Qual", format: "short_9x16", width: "", height: "" })),
    ).rejects.toThrow(/^REDIRECT \/editor\/\S+$/);
  });

  it("a viewer gets the role message from every folder action", async () => {
    const { db, owner, revalidate, actions } = await setup("viewer");
    const { id: project } = await createProject(db, owner, { name: "Qual", format: "short_9x16" });
    const f = await createFolder(db, owner, "Season 2026");
    for (const result of [
      await actions.createFolder(form({ name: "Sponsors" })),
      await actions.renameFolder(form({ id: f.id, name: "Sponsors" })),
      await actions.deleteFolder(form({ id: f.id })),
      await actions.move(form({ id: project, folderId: f.id })),
    ]) {
      expect(result).toEqual({ error: "Your role doesn't allow this." });
    }
    expect(await listFolders(db, owner)).toEqual([{ id: f.id, name: "Season 2026", projectCount: 0 }]);
    expect((await listProjects(db, owner))[0]).toMatchObject({ folderId: null });
    expect(revalidate).not.toHaveBeenCalled();
  });
});
