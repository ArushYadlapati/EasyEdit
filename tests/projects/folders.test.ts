import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import type { Actor } from "@/lib/actor";
import {
  createFolder,
  deleteFolder,
  listFolders,
  moveProject,
  renameFolder,
} from "@/lib/projects/folders";
import { createProject, deleteProject, listProjects } from "@/lib/projects/service";
import { makeTestDb } from "../helpers/db";

const editor: Actor = { userId: "u1", email: "u1@gmail.com", role: "editor" };
const viewer: Actor = { userId: "u9", email: "u9@gmail.com", role: "viewer" };

const INVALID_NAME = { code: "INVALID", message: "Enter a folder name up to 60 characters." };
const NAME_TAKEN = { code: "CONFLICT", status: 409, message: "There's already a folder with that name." };
const GONE = { code: "NOT_FOUND", message: "That folder no longer exists." };
const ROLE = { code: "FORBIDDEN", message: "Your role doesn't allow this." };

// PGlite's clock has millisecond resolution; wait so consecutive writes get distinct timestamps.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

const newProject = (db: DB, name: string) => createProject(db, editor, { name, format: "short_9x16" });

async function listed(db: DB, id: string) {
  return (await listProjects(db, editor)).find((p) => p.id === id);
}

describe("folders", () => {
  it("an editor makes a folder with a trimmed name of 1 to 60 characters", async () => {
    const db = await makeTestDb();
    expect(await createFolder(db, editor, "  Season 2026 ")).toEqual({ id: expect.any(String), name: "Season 2026" });
    expect(await createFolder(db, editor, "x".repeat(60))).toEqual({ id: expect.any(String), name: "x".repeat(60) });
    for (const name of ["", "   ", "x".repeat(61), "a\u0000b"]) {
      await expect(createFolder(db, editor, name)).rejects.toMatchObject(INVALID_NAME);
    }
  });

  it("names are unique regardless of case", async () => {
    const db = await makeTestDb();
    await createFolder(db, editor, "Season 2026");
    await expect(createFolder(db, editor, "Season 2026")).rejects.toMatchObject(NAME_TAKEN);
    await expect(createFolder(db, editor, "season 2026")).rejects.toMatchObject(NAME_TAKEN);
    await expect(createFolder(db, editor, "  season 2026 ")).rejects.toMatchObject(NAME_TAKEN);
  });

  it("a duplicate name the driver wraps, naming the index only in its message, is still refused as taken", async () => {
    const db = await makeTestDb();
    const duplicate = new Error("query failed", {
      cause: Object.assign(new Error('duplicate key value violates unique constraint "folders_name_lower_unique"'), {
        code: "23505",
      }),
    });
    vi.spyOn(db, "insert").mockImplementation(() => ({ values: () => Promise.reject(duplicate) }) as never);
    try {
      await expect(createFolder(db, editor, "Season")).rejects.toMatchObject(NAME_TAKEN);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("listFolders counts each folder's live projects, ordered by name regardless of case", async () => {
    const db = await makeTestDb();
    await createFolder(db, editor, "sponsors");
    await createFolder(db, editor, "Outreach");
    const season = await createFolder(db, editor, "Season");
    const a = await newProject(db, "A");
    const b = await newProject(db, "B");
    await moveProject(db, editor, a.id, season.id);
    await moveProject(db, editor, b.id, season.id);
    await deleteProject(db, editor, b.id);
    expect(await listFolders(db, editor)).toEqual([
      { id: expect.any(String), name: "Outreach", projectCount: 0 },
      { id: season.id, name: "Season", projectCount: 1 },
      { id: expect.any(String), name: "sponsors", projectCount: 0 },
    ]);
  });

  it("a name in lower case sorts among the others", async () => {
    const db = await makeTestDb();
    for (const name of ["Gamma", "beta", "Alpha"]) await createFolder(db, editor, name);
    expect((await listFolders(db, editor)).map((f) => f.name)).toEqual(["Alpha", "beta", "Gamma"]);
  });

  it("rename keeps the id; a name another folder has is refused; changing only the case is fine", async () => {
    const db = await makeTestDb();
    const season = await createFolder(db, editor, "Season");
    const outreach = await createFolder(db, editor, "Outreach");
    expect(await renameFolder(db, editor, season.id, "Season 2026")).toEqual({ id: season.id, name: "Season 2026" });
    await expect(renameFolder(db, editor, outreach.id, "SEASON 2026")).rejects.toMatchObject(NAME_TAKEN);
    expect(await renameFolder(db, editor, season.id, "season 2026")).toEqual({ id: season.id, name: "season 2026" });
    await expect(renameFolder(db, editor, season.id, "   ")).rejects.toMatchObject(INVALID_NAME);
    expect(await listFolders(db, editor)).toEqual([
      { id: outreach.id, name: "Outreach", projectCount: 0 },
      { id: season.id, name: "season 2026", projectCount: 0 },
    ]);
  });

  it("a rename marks the folder changed", async () => {
    const db = await makeTestDb();
    const season = await createFolder(db, editor, "Season");
    await db.execute(sql`update folders set updated_at = '2026-01-01' where id = ${season.id}`);
    await renameFolder(db, editor, season.id, "Season 2026");
    const rows = rowsOf(await db.execute(sql`select updated_at > '2026-01-02' as changed, created_by from folders where id = ${season.id}`));
    expect(rows).toEqual([{ changed: true, created_by: "u1" }]);
  });

  it("deleting a folder keeps its projects, which then sit in no folder", async () => {
    const db = await makeTestDb();
    const season = await createFolder(db, editor, "Season");
    const a = await newProject(db, "A");
    await moveProject(db, editor, a.id, season.id);
    await deleteFolder(db, editor, season.id);
    expect(await listed(db, a.id)).toMatchObject({ id: a.id, folderId: null });
    await expect(deleteFolder(db, editor, season.id)).rejects.toMatchObject(GONE);
    await expect(renameFolder(db, editor, season.id, "Season 2026")).rejects.toMatchObject(GONE);
  });

  it("moving a project in and out changes neither its version, its last change nor the order", async () => {
    const db = await makeTestDb();
    const season = await createFolder(db, editor, "Season");
    const a = await newProject(db, "A");
    await nextMillisecond();
    const b = await newProject(db, "B");
    const before = (await listed(db, a.id))!;
    await moveProject(db, editor, a.id, season.id);
    expect((await listProjects(db, editor)).map((p) => p.id)).toEqual([b.id, a.id]);
    const moved = (await listed(db, a.id))!;
    expect(moved.updatedAt).toEqual(before.updatedAt);
    expect(moved.updatedBy).toBe(before.updatedBy);
    expect(moved.version).toBe(0);
    expect(moved.folderId).toBe(season.id);
    await moveProject(db, editor, a.id, null);
    expect((await listed(db, a.id))!.folderId).toBeNull();
  });

  it("moving refuses a deleted project and a folder that is gone", async () => {
    const db = await makeTestDb();
    const season = await createFolder(db, editor, "Season");
    const deleted = await newProject(db, "Old");
    await deleteProject(db, editor, deleted.id);
    await expect(moveProject(db, editor, deleted.id, season.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: `Project "${deleted.id}" not found`,
    });
    const a = await newProject(db, "A");
    await moveProject(db, editor, a.id, season.id);
    await expect(moveProject(db, editor, a.id, "gone")).rejects.toMatchObject(GONE);
    expect((await listed(db, a.id))!.folderId).toBe(season.id);
  });

  it("a folder already gone is refused by the move's own check, then one read tells why", async () => {
    const db = await makeTestDb();
    const a = await newProject(db, "A");
    const select = vi.spyOn(db, "select");
    await expect(moveProject(db, editor, a.id, "gone")).rejects.toMatchObject(GONE);
    expect(select).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("a folder deleted between a move's check and its foreign key is gone", async () => {
    const db = await makeTestDb();
    const season = await createFolder(db, editor, "Season");
    const a = await newProject(db, "A");
    // Runs after the update has checked the folder and before the foreign key is, as another writer's delete
    // would land.
    await db.execute(sql`
      create function delete_folder_mid_move() returns trigger language plpgsql as $$
      begin delete from folders where id = new.folder_id; return new; end $$
    `);
    await db.execute(sql`create trigger mid_move before update on projects for each row execute function delete_folder_mid_move()`);
    await expect(moveProject(db, editor, a.id, season.id)).rejects.toMatchObject(GONE);
    expect((await listed(db, a.id))!.folderId).toBeNull();
  });

  it("a viewer lists folders and changes nothing", async () => {
    const db = await makeTestDb();
    const season = await createFolder(db, editor, "Season");
    const a = await newProject(db, "A");
    await expect(createFolder(db, viewer, "Outreach")).rejects.toMatchObject(ROLE);
    await expect(renameFolder(db, viewer, season.id, "Season 2026")).rejects.toMatchObject(ROLE);
    await expect(deleteFolder(db, viewer, season.id)).rejects.toMatchObject(ROLE);
    await expect(moveProject(db, viewer, a.id, season.id)).rejects.toMatchObject(ROLE);
    expect(await listFolders(db, viewer)).toEqual([{ id: season.id, name: "Season", projectCount: 0 }]);
    expect((await listed(db, a.id))!.folderId).toBeNull();
  });
});
