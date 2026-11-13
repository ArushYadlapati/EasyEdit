import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { folders } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import {
  applyProjectOps,
  createProject,
  duplicateProject,
  failedOn,
  getOpsSince,
  getProject,
  getProjectVersion,
  isFolderGone,
  listProjects,
  type OpsPage,
} from "@/lib/projects/service";
import { DEFAULT_TRANSFORM, FRAME_SIZE_MESSAGE, createEmptyDoc, type OpInput, type TextClip } from "@/lib/timeline";
import { makeTestDb } from "../helpers/db";

const as = (userId: string): Actor => ({ userId, email: `${userId}@gmail.com`, role: "editor" });

function textClip(overrides: Partial<Record<keyof TextClip, unknown>> = {}) {
  return {
    id: "c1",
    type: "text",
    start: 0,
    duration: 30,
    transform: { ...DEFAULT_TRANSFORM },
    text: "hi",
    style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700, color: "#fff", align: "center" },
    ...overrides,
  } as Extract<OpInput, { op: "add_clip" }>["clip"];
}

async function loggedVersions(db: DB, projectId: string): Promise<number[]> {
  const rows = rowsOf<{ version: number }>(
    await db.execute(sql`select version from project_ops where project_id = ${projectId} order by version`),
  );
  return rows.map((r) => r.version);
}

async function seedTwoClips(db: DB) {
  const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
  const r = await applyProjectOps(db, as("u1"), {
    projectId: id,
    baseVersion: 0,
    ops: [
      { op: "add_clip", trackId: "t1", clip: textClip({ id: "c1", start: 0 }) },
      { op: "add_clip", trackId: "t1", clip: textClip({ id: "c2", start: 60 }) },
    ],
  });
  expect(r).toMatchObject({ version: 1 });
  return id;
}

// PGlite's clock has millisecond resolution; wait so consecutive writes get distinct timestamps.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

function textClips(doc: { tracks: { id: string; clips: unknown[] }[] }) {
  return doc.tracks.find((t) => t.id === "t1")!.clips as TextClip[];
}

type StoredRow = { format: string; width: number | null; height: number | null; folder_id: string | null };

async function storedRow(db: DB, id: string): Promise<StoredRow> {
  const rows = rowsOf<StoredRow>(await db.execute(sql`select format, width, height, folder_id from projects where id = ${id}`));
  return rows[0];
}

// What a row written by the code before sizes were stored looks like.
const clearStoredSize = (db: DB, id: string) => db.execute(sql`update projects set width = null, height = null where id = ${id}`);

describe("projects service", () => {
  it("create → apply → version 1 and op logged", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
    const r = await applyProjectOps(db, as("u1"), {
      projectId: id,
      baseVersion: 0,
      ops: [{ op: "add_clip", trackId: "t1", clip: textClip({ id: undefined }) }],
    });
    expect(r).toMatchObject({ version: 1 });
    const op = r.ops[0] as Extract<OpInput, { op: "add_clip" }>;
    expect(op.clip.id).toEqual(expect.any(String));
    const since = await getOpsSince(db, as("u1"), id, 0);
    expect(since!.entries).toHaveLength(1);
    expect(since).toEqual({
      version: 1,
      entries: [{ version: 1, ops: r.ops, inverse: [{ op: "remove_clip", clipId: op.clip.id }], actor: "u1", requestId: null, createdAt: expect.any(Date) }],
      hasMore: false,
    });
    const project = await getProject(db, as("u1"), id);
    expect(project).toMatchObject({ version: 1, updatedBy: "u1" });
    expect(textClips(project!.doc).map((c) => c.id)).toEqual([op.clip.id]);
  });

  it("createProject stores an empty doc at version 0 and getProject returns it", async () => {
    const db = await makeTestDb();
    const created = await createProject(db, as("u7"), { name: "Worlds reel", format: "long_16x9" });
    expect(created).toEqual({ id: expect.any(String), version: 0 });
    const project = await getProject(db, as("u1"), created.id);
    expect(project).toEqual({
      id: created.id,
      name: "Worlds reel",
      format: "long_16x9",
      doc: createEmptyDoc("long_16x9"),
      version: 0,
      updatedBy: "u7",
      updatedAt: expect.any(Date),
    });
  });

  it("listProjects returns every project, most recently updated first", async () => {
    const db = await makeTestDb();
    const a = await createProject(db, as("u1"), { name: "A", format: "short_9x16" });
    await nextMillisecond();
    const b = await createProject(db, as("u2"), { name: "B", format: "square_1x1" });
    expect((await listProjects(db, as("u1"))).map((p) => p.id)).toEqual([b.id, a.id]);
    await nextMillisecond();
    await applyProjectOps(db, as("u3"), {
      projectId: a.id,
      baseVersion: 0,
      ops: [{ op: "add_clip", trackId: "t1", clip: textClip() }],
    });
    const list = await listProjects(db, as("u1"));
    expect(list.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(list[0]).toEqual({
      id: a.id,
      name: "A",
      format: "short_9x16",
      width: 1080,
      height: 1920,
      folderId: null,
      version: 1,
      createdAt: expect.any(Date),
      updatedBy: "u3",
      updatedAt: expect.any(Date),
    });
  });

  it("a custom size is stored in the doc and the columns, and a named size's own numbers make that named size", async () => {
    const db = await makeTestDb();
    const poster = await createProject(db, as("u1"), { name: "Poster", format: "custom", width: 816, height: 1056 });
    expect((await getProject(db, as("u1"), poster.id))!.doc).toEqual(createEmptyDoc("custom", { width: 816, height: 1056 }));
    const short = await createProject(db, as("u1"), { name: "Tall", format: "custom", width: 1080, height: 1920 });
    const list = await listProjects(db, as("u1"));
    expect(list.find((p) => p.id === poster.id)).toMatchObject({ format: "custom", width: 816, height: 1056 });
    expect(list.find((p) => p.id === short.id)).toMatchObject({ format: "short_9x16", width: 1080, height: 1920 });
    expect((await getProject(db, as("u1"), short.id))!.doc).toEqual(createEmptyDoc("short_9x16"));
    expect(await storedRow(db, poster.id)).toMatchObject({ format: "custom", width: 816, height: 1056 });
    expect(await storedRow(db, short.id)).toMatchObject({ format: "short_9x16", width: 1080, height: 1920 });
  });

  it("createProject explains a bad size", async () => {
    const db = await makeTestDb();
    for (const size of [{ width: 4096, height: 4096 }, {}, { width: 1081, height: 1920 }]) {
      await expect(createProject(db, as("u1"), { name: "Poster", format: "custom", ...size })).rejects.toMatchObject({
        code: "INVALID",
        message: FRAME_SIZE_MESSAGE,
      });
    }
    for (const size of [{ width: 1080 }, { height: 1920 }]) {
      await expect(createProject(db, as("u1"), { name: "Poster", format: "short_9x16", ...size })).rejects.toMatchObject({
        code: "INVALID",
        message: "Give a width and height only with the custom format.",
      });
    }
    for (const format of ["imax", "constructor"]) {
      await expect(createProject(db, as("u1"), { name: "Poster", format })).rejects.toMatchObject({
        code: "INVALID",
        message: "Pick a format.",
      });
    }
    expect(await listProjects(db, as("u1"))).toEqual([]);
  });

  it("a new project goes into the folder given, and into none when that folder is gone", async () => {
    const db = await makeTestDb();
    await db.insert(folders).values({ id: "f1", name: "Season 2026", createdBy: "u1" });
    const inFolder = await createProject(db, as("u1"), { name: "A", format: "short_9x16", folderId: "f1" });
    const gone = await createProject(db, as("u1"), { name: "B", format: "short_9x16", folderId: "gone" });
    const list = await listProjects(db, as("u1"));
    expect(list.find((p) => p.id === inFolder.id)!.folderId).toBe("f1");
    expect(list.find((p) => p.id === gone.id)!.folderId).toBeNull();
  });

  it("a new project's columns hold its named size", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Reel", format: "long_16x9" });
    expect(await storedRow(db, id)).toEqual({ format: "long_16x9", width: 1920, height: 1080, folder_id: null });
  });

  it("a folder already gone is left out by the insert itself, with no second try", async () => {
    const db = await makeTestDb();
    const insert = vi.spyOn(db, "insert");
    const { id } = await createProject(db, as("u1"), { name: "A", format: "short_9x16", folderId: "gone" });
    expect(insert).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    expect(await storedRow(db, id)).toMatchObject({ folder_id: null });
  });

  it("failedOn matches a Postgres code on a named constraint, through wrapped causes or in the message alone", () => {
    const wrapped = (inner: Error) => new Error("query failed", { cause: new Error("driver", { cause: inner }) });
    const named = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "some_index" });
    const inMessage = Object.assign(new Error('duplicate key value violates unique constraint "some_index"'), {
      code: "23505",
    });
    expect(failedOn(wrapped(named), "23505", "some_index")).toBe(true);
    expect(failedOn(wrapped(inMessage), "23505", "some_index")).toBe(true);
    expect(failedOn(wrapped(named), "23503", "some_index")).toBe(false);
    expect(failedOn(wrapped(named), "23505", "other_index")).toBe(false);
    expect(failedOn("text", "23505", "some_index")).toBe(false);
  });

  it("a folder deleted mid-write is recognised", () => {
    const fkError = (constraint: string, code = "23503") =>
      new Error("insert failed", {
        cause: Object.assign(new Error(`violates foreign key constraint "${constraint}"`), { code, constraint }),
      });
    expect(isFolderGone(fkError("projects_folder_id_folders_id_fk"))).toBe(true);
    expect(isFolderGone(fkError("project_ops_project_id_projects_id_fk"))).toBe(false);
    expect(isFolderGone(fkError("projects_folder_id_folders_id_fk", "23505"))).toBe(false);
    expect(isFolderGone("text")).toBe(false);
  });

  it("a folder deleted between a write's read and its foreign key leaves the new project and the copy in no folder", async () => {
    const db = await makeTestDb();
    await db.insert(folders).values({ id: "f1", name: "Season 2026", createdBy: "u1" });
    const source = await createProject(db, as("u1"), { name: "Poster", format: "short_9x16", folderId: "f1" });
    // Runs after the insert has read the folder id and before the foreign key is checked, as another writer's
    // delete would land.
    await db.execute(sql`
      create function delete_folder_mid_write() returns trigger language plpgsql as $$
      begin delete from folders where id = new.folder_id; return new; end $$
    `);
    await db.execute(sql`create trigger mid_write before insert on projects for each row execute function delete_folder_mid_write()`);
    const created = await createProject(db, as("u1"), { name: "New", format: "short_9x16", folderId: "f1" });
    expect(await storedRow(db, created.id)).toMatchObject({ folder_id: null });

    await db.insert(folders).values({ id: "f2", name: "Season 2027", createdBy: "u1" });
    await db.execute(sql`alter table projects disable trigger mid_write`);
    await db.execute(sql`update projects set folder_id = 'f2' where id = ${source.id}`);
    await db.execute(sql`alter table projects enable trigger mid_write`);
    const copy = await duplicateProject(db, as("u1"), source.id);
    expect(await storedRow(db, copy.id)).toMatchObject({ folder_id: null, width: 1080, height: 1920 });
    expect((await getProject(db, as("u1"), copy.id))!.name).toBe("Poster copy");
  });

  it("width and height follow every write", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "P", format: "short_9x16" });
    await applyProjectOps(db, as("u1"), { projectId: id, baseVersion: 0, ops: [{ op: "set_format", format: "long_16x9" }] });
    expect(await storedRow(db, id)).toMatchObject({ width: 1920, height: 1080 });
    const custom = await applyProjectOps(db, as("u1"), {
      projectId: id,
      baseVersion: 1,
      ops: [{ op: "set_format", format: "custom", width: 816, height: 1056 }],
    });
    expect(await storedRow(db, id)).toMatchObject({ width: 816, height: 1056 });
    await applyProjectOps(db, as("u1"), { projectId: id, baseVersion: 2, ops: custom.inverse });
    expect(await storedRow(db, id)).toMatchObject({ width: 1920, height: 1080 });
  });

  it("duplicate keeps the folder and the size", async () => {
    const db = await makeTestDb();
    await db.insert(folders).values({ id: "f1", name: "Season 2026", createdBy: "u1" });
    const { id } = await createProject(db, as("u1"), { name: "Poster", format: "custom", width: 816, height: 1056, folderId: "f1" });
    await clearStoredSize(db, id);
    const copy = await duplicateProject(db, as("u1"), id);
    expect(await storedRow(db, copy.id)).toMatchObject({ folder_id: "f1", width: 816, height: 1056 });
  });

  it("a row written without width and height lists its doc's size", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "P", format: "short_9x16" });
    await clearStoredSize(db, id);
    expect(await listProjects(db, as("u1"))).toMatchObject([{ id, width: 1080, height: 1920 }]);
  });

  it("set_format updates the project's stored format with the doc", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
    const r = await applyProjectOps(db, as("u1"), {
      projectId: id,
      baseVersion: 0,
      ops: [{ op: "set_format", format: "long_16x9" }],
    });
    expect(r).toMatchObject({ version: 1 });
    const project = await getProject(db, as("u1"), id);
    expect(project!.doc.format).toBe("long_16x9");
    expect(project!.format).toBe("long_16x9");
    expect((await listProjects(db, as("u1"))).find((p) => p.id === id)!.format).toBe("long_16x9");

    await applyProjectOps(db, as("u1"), {
      projectId: id,
      baseVersion: 1,
      ops: [{ op: "set_format", format: "custom", width: 816, height: 1056 }],
    });
    const custom = await getProject(db, as("u1"), id);
    expect(custom!.format).toBe("custom");
    expect(custom!.doc.format).toBe("custom");
    expect(custom!.doc.width).toBe(816);
  });

  it("invalid op leaves doc and version unchanged", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
    await expect(
      applyProjectOps(db, as("u1"), {
        projectId: id,
        baseVersion: 0,
        ops: [{ op: "remove_clip", clipId: "nope" }],
      }),
    ).rejects.toMatchObject({ status: 400, code: "NOT_FOUND", opIndex: 0 });
    const project = await getProject(db, as("u1"), id);
    expect(project!.version).toBe(0);
    expect(project!.doc).toEqual(createEmptyDoc("short_9x16"));
    expect(await loggedVersions(db, id)).toEqual([]);
  });

  it("an op that fails part way through the batch reports its index and writes nothing", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
    await expect(
      applyProjectOps(db, as("u1"), {
        projectId: id,
        baseVersion: 0,
        ops: [
          { op: "add_clip", trackId: "t1", clip: textClip({ id: "c1" }) },
          { op: "move_clip", clipId: "ghost", start: 10 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, code: "NOT_FOUND", opIndex: 1 });
    expect((await getProject(db, as("u1"), id))!.version).toBe(0);
    expect(await loggedVersions(db, id)).toEqual([]);
  });

  it("empty ops are rejected as INVALID", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
    const r = applyProjectOps(db, as("u1"), { projectId: id, baseVersion: 0, ops: [] });
    await expect(r).rejects.toMatchObject({ status: 400, code: "INVALID" });
    await expect(r).rejects.not.toHaveProperty("opIndex");
    expect((await getProject(db, as("u1"), id))!.version).toBe(0);
  });

  it("ops that fail validation are rejected as INVALID with the op index", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
    await expect(
      applyProjectOps(db, as("u1"), {
        projectId: id,
        baseVersion: 0,
        ops: [
          { op: "add_clip", trackId: "t1", clip: textClip() },
          { op: "move_clip", clipId: "c1", start: -5 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID", opIndex: 1, message: expect.any(String) });
    expect((await getProject(db, as("u1"), id))!.version).toBe(0);
    expect(await loggedVersions(db, id)).toEqual([]);
  });

  it("claude and human editing different clips from the same base both land", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    // Pass-through spy on the real database: records how many rows each conditional write returned.
    const writes: number[] = [];
    const execute = db.execute.bind(db);
    vi.spyOn(db, "execute").mockImplementation(
      (query) =>
        execute(query).then((result) => {
          writes.push(rowsOf(result).length);
          return result;
        }) as never,
    );

    const [claude, human] = await Promise.allSettled([
      applyProjectOps(db, as("claude:u1"), {
        projectId: id,
        baseVersion: 1,
        ops: [{ op: "move_clip", clipId: "c1", start: 120 }],
      }),
      applyProjectOps(db, as("u2"), {
        projectId: id,
        baseVersion: 1,
        ops: [{ op: "update_clip", clipId: "c2", patch: { text: "Finals!" } }],
      }),
    ]);

    expect(claude.status).toBe("fulfilled");
    expect(human.status).toBe("fulfilled");
    const versions = [claude, human].map((r) => (r as PromiseFulfilledResult<{ version: number }>).value.version);
    expect(versions.sort()).toEqual([2, 3]);

    // Both read version 1, so one conditional write must have matched zero rows and been retried.
    expect(writes).toEqual([1, 0, 1]);
    vi.restoreAllMocks();

    const project = await getProject(db, as("u1"), id);
    expect(project!.version).toBe(3);
    const clips = textClips(project!.doc);
    expect(clips.find((c) => c.id === "c1")).toMatchObject({ start: 120, text: "hi" });
    expect(clips.find((c) => c.id === "c2")).toMatchObject({ start: 60, text: "Finals!" });
    expect(await loggedVersions(db, id)).toEqual([1, 2, 3]);
    const actors = (await getOpsSince(db, as("u1"), id, 1))!.entries.map((e) => e.actor).sort();
    expect(actors).toEqual(["claude:u1", "u2"]);
  });

  it("stale base whose ops no longer validate is rejected", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    const human = await applyProjectOps(db, as("u2"), {
      projectId: id,
      baseVersion: 1,
      ops: [{ op: "remove_clip", clipId: "c1" }],
    });
    expect(human).toMatchObject({ version: 2 });
    await expect(
      applyProjectOps(db, as("claude:u1"), {
        projectId: id,
        baseVersion: 1,
        ops: [{ op: "move_clip", clipId: "c1", start: 120 }],
      }),
    ).rejects.toMatchObject({ status: 400, code: "NOT_FOUND", opIndex: 0 });
    expect((await getProject(db, as("u1"), id))!.version).toBe(2);
    expect(await loggedVersions(db, id)).toEqual([1, 2]);
  });

  it("a base version ahead of the project is a 409 conflict", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "Qual recap", format: "short_9x16" });
    await expect(
      applyProjectOps(db, as("u1"), {
        projectId: id,
        baseVersion: 5,
        ops: [{ op: "add_clip", trackId: "t1", clip: textClip() }],
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT", currentVersion: 0 });
    expect((await getProject(db, as("u1"), id))!.version).toBe(0);
  });

  it("gives up with 409 CONFLICT after losing the race three times", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) =>
        applyProjectOps(db, as(`u${n}`), {
          projectId: id,
          baseVersion: 1,
          ops: [{ op: "update_clip", clipId: "c1", patch: { text: `edit ${n}` } }],
        }),
      ),
    );
    const landed = results.filter((r) => r.status === "fulfilled");
    const conflicts = results.filter((r) => r.status === "rejected");
    expect(landed.map((r) => r.value.version).sort()).toEqual([2, 3, 4]);
    expect(conflicts).toHaveLength(2);
    for (const r of conflicts) {
      expect(r.reason).toMatchObject({ status: 409, code: "CONFLICT", currentVersion: 4 });
    }
    expect((await getProject(db, as("u1"), id))!.version).toBe(4);
    expect(await loggedVersions(db, id)).toEqual([1, 2, 3, 4]);
  });

  const bump = (db: DB, id: string, v: number) =>
    applyProjectOps(db, as("u1"), { projectId: id, baseVersion: v, ops: [{ op: "update_track", trackId: "v1", patch: { name: `V${v}` } }] });

  it("pages through the op log; following version never skips or repeats an entry", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "P", format: "short_9x16" });
    for (let v = 0; v < 5; v++) await bump(db, id, v);
    const first = (await getOpsSince(db, as("u1"), id, 0, 2))!;
    expect(first).toMatchObject({ version: 2, hasMore: true });
    expect(first.entries.map((e) => e.version)).toEqual([1, 2]);
    const seen: number[] = [];
    let since = 0;
    let page: OpsPage;
    do {
      page = (await getOpsSince(db, as("u1"), id, since, 2))!;
      seen.push(...page.entries.map((e) => e.version));
      since = page.version;
    } while (page.hasMore);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(page).toMatchObject({ version: 5, hasMore: false });
  });

  it("returns at most 100 entries by default", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "P", format: "short_9x16" });
    for (let v = 0; v < 101; v++) await bump(db, id, v);
    const page = (await getOpsSince(db, as("u1"), id, 0))!;
    expect(page.entries).toHaveLength(100);
    expect(page).toMatchObject({ version: 100, hasMore: true });
  });

  it("getProjectVersion returns the version, or null for an unknown project", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    expect(await getProjectVersion(db, as("u1"), id)).toBe(1);
    expect(await getProjectVersion(db, as("u1"), "missing")).toBeNull();
  });

  it("getOpsSince with current version returns no entries", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    // Hide the op log: the cheap poll must not need it.
    await db.execute(sql`alter table project_ops rename to project_ops_hidden`);
    expect(await getOpsSince(db, as("u1"), id, 1)).toEqual({ version: 1, entries: [], hasMore: false });
    await db.execute(sql`alter table project_ops_hidden rename to project_ops`);
    const since0 = await getOpsSince(db, as("u1"), id, 0);
    expect(since0!.version).toBe(1);
    expect(since0!.entries.map((e) => e.version)).toEqual([1]);
  });

  it("getOpsSince never returns entries newer than the version it reports", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    // Pass-through spy on the real client: right after getOpsSince's first statement (the version read)
    // finishes, another writer commits version 2 before getOpsSince's next statement runs.
    const client = (db as unknown as { $client: PGlite }).$client;
    const query = client.query.bind(client);
    let interleaved = false;
    vi.spyOn(client, "query").mockImplementation((async (...args: Parameters<PGlite["query"]>) => {
      const result = await query(...args);
      if (!interleaved) {
        interleaved = true;
        const write = await applyProjectOps(db, as("u2"), {
          projectId: id,
          baseVersion: 1,
          ops: [{ op: "move_clip", clipId: "c2", start: 200 }],
        });
        expect(write).toMatchObject({ version: 2 });
      }
      return result;
    }) as PGlite["query"]);

    const polled = await getOpsSince(db, as("u1"), id, 0);
    vi.restoreAllMocks();

    expect(interleaved).toBe(true);
    expect(polled!.version).toBe(1);
    expect(polled!.entries.map((e) => e.version)).toEqual([1]);
    // The next poll from the reported version picks up version 2 exactly once.
    const next = await getOpsSince(db, as("u1"), id, polled!.version);
    expect(next!.version).toBe(2);
    expect(next!.entries.map((e) => e.version)).toEqual([2]);
  });

  it("getOpsSince returns only the entries after the given version, in order", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    await applyProjectOps(db, as("u2"), { projectId: id, baseVersion: 1, ops: [{ op: "remove_clip", clipId: "c2" }] });
    await applyProjectOps(db, as("claude:u1"), {
      projectId: id,
      baseVersion: 2,
      ops: [{ op: "move_clip", clipId: "c1", start: 90 }],
    });
    expect(await getOpsSince(db, as("u1"), id, 1)).toEqual({
      version: 3,
      entries: [
        {
          version: 2,
          ops: [{ op: "remove_clip", clipId: "c2" }],
          inverse: [{ op: "add_clip", trackId: "t1", clip: textClip({ id: "c2", start: 60 }) }],
          actor: "u2",
          requestId: null,
          createdAt: expect.any(Date),
        },
        {
          version: 3,
          ops: [{ op: "move_clip", clipId: "c1", start: 90 }],
          inverse: [{ op: "move_clip", clipId: "c1", start: 0, expect: { start: 90 } }],
          actor: "claude:u1",
          requestId: null,
          createdAt: expect.any(Date),
        },
      ],
      hasMore: false,
    });
  });

  it("returns and stores the inverse of each write; rows from before this change read back as null", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("u1"), { name: "P", format: "short_9x16" });
    const r = await applyProjectOps(db, as("u1"), { projectId: id, baseVersion: 0, ops: [{ op: "add_clip", trackId: "t1", clip: textClip({ id: "c9" }) }] });
    expect(r.inverse).toEqual([{ op: "remove_clip", clipId: "c9" }]);
    expect((await getOpsSince(db, as("u1"), id, 0))!.entries).toEqual([
      { version: 1, ops: r.ops, inverse: r.inverse, actor: "u1", requestId: null, createdAt: expect.any(Date) },
    ]);
    await db.execute(sql`update project_ops set inverse = null`);
    expect((await getOpsSince(db, as("u1"), id, 0))!.entries[0].inverse).toBeNull();
  });

  it("undo is an ordinary edit: A's stored inverse removes only A's clip after B's edit", async () => {
    const db = await makeTestDb();
    const { id } = await createProject(db, as("a"), { name: "P", format: "short_9x16" });
    await applyProjectOps(db, as("a"), { projectId: id, baseVersion: 0, ops: [{ op: "add_clip", trackId: "t1", clip: textClip({ id: "ax", start: 0 }) }] });
    await applyProjectOps(db, as("b"), { projectId: id, baseVersion: 1, ops: [{ op: "add_clip", trackId: "t1", clip: textClip({ id: "by", start: 60 }) }] });
    const stored = (await getOpsSince(db, as("a"), id, 0))!.entries[0].inverse!;
    const undo = await applyProjectOps(db, as("a"), { projectId: id, baseVersion: 2, strict: true, ops: stored });
    expect(undo.version).toBe(3);
    expect(textClips((await getProject(db, as("a"), id))!.doc).map((c) => c.id)).toEqual(["by"]);
    expect(undo.inverse).toEqual([{ op: "add_clip", trackId: "t1", clip: textClip({ id: "ax", start: 0 }) }]);
  });

  it("strict refuses a stale base with 409 and writes nothing; strict at the current version lands", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    await applyProjectOps(db, as("u2"), { projectId: id, baseVersion: 1, ops: [{ op: "remove_clip", clipId: "c2" }] });
    await expect(applyProjectOps(db, as("u1"), { projectId: id, baseVersion: 1, strict: true, ops: [{ op: "move_clip", clipId: "c1", start: 90 }] }))
      .rejects.toMatchObject({ status: 409, code: "CONFLICT", currentVersion: 2 });
    expect(await loggedVersions(db, id)).toEqual([1, 2]);
    await expect(applyProjectOps(db, as("u1"), { projectId: id, baseVersion: 2, strict: true, ops: [{ op: "move_clip", clipId: "c1", start: 90 }] }))
      .resolves.toMatchObject({ version: 3 });
  });

  it("two strict writes from the same base: one lands, the other is refused and never rebased", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    const results = await Promise.allSettled([
      applyProjectOps(db, as("u1"), { projectId: id, baseVersion: 1, strict: true, ops: [{ op: "move_clip", clipId: "c1", start: 120 }] }),
      applyProjectOps(db, as("u2"), { projectId: id, baseVersion: 1, strict: true, ops: [{ op: "update_clip", clipId: "c2", patch: { text: "Finals!" } }] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 409, code: "CONFLICT", currentVersion: 2 });
    expect(await loggedVersions(db, id)).toEqual([1, 2]);
  });

  it("a rebased write returns and stores the inverse against the doc it finally landed on", async () => {
    const db = await makeTestDb();
    const id = await seedTwoClips(db);
    // Pass-through spy on the real database: just before this write's first conditional update runs,
    // another writer moves c1 to 30, so the first attempt (which read c1 at 0) loses and is rebased.
    const execute = db.execute.bind(db);
    let interleaved = false;
    vi.spyOn(db, "execute").mockImplementation((async (query: Parameters<DB["execute"]>[0]) => {
      if (!interleaved) {
        interleaved = true;
        const other = await applyProjectOps(db, as("u2"), {
          projectId: id,
          baseVersion: 1,
          ops: [{ op: "move_clip", clipId: "c1", start: 30 }],
        });
        expect(other).toMatchObject({ version: 2 });
      }
      return execute(query);
    }) as never);

    const r = await applyProjectOps(db, as("u1"), {
      projectId: id,
      baseVersion: 1,
      ops: [{ op: "move_clip", clipId: "c1", start: 120 }],
    });
    vi.restoreAllMocks();

    expect(interleaved).toBe(true);
    expect(r.version).toBe(3);
    // Against the first read c1 was at 0; against the doc it landed on, c1 was at 30.
    expect(r.inverse).toEqual([{ op: "move_clip", clipId: "c1", start: 30, expect: { start: 120 } }]);
    const stored = (await getOpsSince(db, as("u1"), id, 2))!.entries;
    expect(stored.map((e) => ({ version: e.version, inverse: e.inverse }))).toEqual([{ version: 3, inverse: r.inverse }]);
  });

  it("unknown project → 404", async () => {
    const db = await makeTestDb();
    const r = applyProjectOps(db, as("u1"), {
      projectId: "missing",
      baseVersion: 0,
      ops: [{ op: "add_clip", trackId: "t1", clip: textClip() }],
    });
    await expect(r).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(r).rejects.not.toHaveProperty("opIndex");
    expect(await getProject(db, as("u1"), "missing")).toBeNull();
    expect(await getOpsSince(db, as("u1"), "missing", 0)).toBeNull();
    expect(await loggedVersions(db, "missing")).toEqual([]);
  });
});
