import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf, type DB } from "@/db";
import type { Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import {
  applyProjectOps,
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  listProjects,
} from "@/lib/projects/service";
import { isJpeg, readThumbnail, saveThumbnail } from "@/lib/projects/thumbnails";
import { DEFAULT_TRANSFORM, type OpInput } from "@/lib/timeline";
import { makeTestDb } from "../helpers/db";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

// n bytes that start like a JPEG.
function jpegOf(n: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
}

// n bytes that start like a JPEG, the rest from a small seeded generator, so Postgres cannot compress them and stores
// them out of line.
function noise(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = jpegOf(n);
  let state = seed >>> 0;
  for (let i = 3; i < n; i++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

const as = (role: Role, userId = `u-${role}`): Actor => ({ userId, email: `${userId}@gmail.com`, role });
const editor = as("editor");
const viewer = as("viewer");

// PGlite's clock has millisecond resolution; wait so consecutive writes get distinct timestamps.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

function textClip(id: string, start: number) {
  return {
    id,
    type: "text",
    start,
    duration: 30,
    transform: { ...DEFAULT_TRANSFORM },
    text: "hi",
    style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700, color: "#fff", align: "center" },
  } as Extract<OpInput, { op: "add_clip" }>["clip"];
}

// A project at version 2: created, then two edits.
async function projectAtVersion2(db: DB, name = "Qual recap"): Promise<string> {
  const { id } = await createProject(db, editor, { name, format: "short_9x16" });
  for (const [baseVersion, clipId, start] of [[0, "c1", 0], [1, "c2", 60]] as const) {
    const clip = textClip(clipId, start);
    await applyProjectOps(db, editor, { projectId: id, baseVersion, ops: [{ op: "add_clip", trackId: "t1", clip }] });
  }
  return id;
}

describe("project thumbnails", () => {
  it("an editor saves a picture, and any member reads it back", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    expect(await saveThumbnail(db, editor, id, 2, JPEG)).toEqual({ saved: true });
    const read = await readThumbnail(db, viewer, id);
    expect(read).toMatchObject({ version: 2 });
    expect([...read!.jpeg]).toEqual([...JPEG]);
  });

  it("an older picture never replaces a newer one, and the same version is written once", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    expect(await saveThumbnail(db, editor, id, 1, jpegOf(10))).toEqual({ saved: true });
    expect(await saveThumbnail(db, editor, id, 2, JPEG)).toEqual({ saved: true });
    expect(await saveThumbnail(db, editor, id, 1, jpegOf(10))).toEqual({ saved: false });
    // Another editor's picture of the same version.
    expect(await saveThumbnail(db, as("editor", "u-other"), id, 2, jpegOf(20))).toEqual({ saved: false });
    const read = await readThumbnail(db, viewer, id);
    expect(read!.version).toBe(2);
    expect([...read!.jpeg]).toEqual([...JPEG]);
  });

  it("a picture of a version the project has not reached is not kept", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    expect(await saveThumbnail(db, editor, id, 3, JPEG)).toEqual({ saved: false });
    expect(await readThumbnail(db, viewer, id)).toBeNull();
  });

  it("saving a picture changes neither the version, who changed it or when, nor the list's order", async () => {
    const db = await makeTestDb();
    const a = await createProject(db, as("editor", "u-a"), { name: "A", format: "short_9x16" });
    await nextMillisecond();
    const b = await createProject(db, as("editor", "u-b"), { name: "B", format: "short_9x16" });
    expect((await listProjects(db, viewer)).map((p) => p.id)).toEqual([b.id, a.id]);
    const before = (await getProject(db, viewer, a.id))!;
    await nextMillisecond();
    expect(await saveThumbnail(db, editor, a.id, 0, JPEG)).toEqual({ saved: true });
    expect((await listProjects(db, viewer)).map((p) => p.id)).toEqual([b.id, a.id]);
    const after = (await getProject(db, viewer, a.id))!;
    expect(after.version).toBe(before.version);
    expect(after.updatedBy).toBe(before.updatedBy);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(rowsOf(await db.execute(sql`select count(*)::int as n from project_ops where project_id = ${a.id}`))).toEqual([
      { n: 0 },
    ]);
  });

  it("a deleted or missing project takes no picture and serves none", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    expect(await saveThumbnail(db, editor, id, 2, JPEG)).toEqual({ saved: true });
    await deleteProject(db, editor, id);
    expect(await readThumbnail(db, viewer, id)).toBeNull();
    expect(await saveThumbnail(db, editor, id, 2, jpegOf(10))).toEqual({ saved: false });
    expect(
      rowsOf(
        await db.execute(
          sql`select thumbnail is null and thumbnail_version is null as gone from projects where id = ${id}`,
        ),
      ),
    ).toEqual([{ gone: true }]);
    expect(await saveThumbnail(db, editor, "nope", 0, JPEG)).toEqual({ saved: false });
    expect(await readThumbnail(db, viewer, "nope")).toBeNull();
  });

  it("a deleted project that still holds a picture serves none", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    expect(await saveThumbnail(db, editor, id, 2, JPEG)).toEqual({ saved: true });
    // Deleted without clearing its picture, as a row deleted some other way would be.
    await db.execute(sql`update projects set deleted_at = now() where id = ${id}`);
    expect(await readThumbnail(db, viewer, id)).toBeNull();
  });

  it("the same picture for a newer version keeps its stored bytes", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    const chunk = async () =>
      rowsOf<{ chunk: string | null }>(
        await db.execute(sql`select pg_column_toast_chunk_id(thumbnail)::text as chunk from projects where id = ${id}`),
      )[0].chunk;
    const x = noise(50_000, 1);
    expect(await saveThumbnail(db, editor, id, 0, x)).toEqual({ saved: true });
    const first = await chunk();
    // Stored out of line.
    expect(first).not.toBeNull();

    expect(await saveThumbnail(db, editor, id, 1, x.slice())).toEqual({ saved: true });
    expect(await chunk()).toBe(first);
    const same = await readThumbnail(db, viewer, id);
    expect(same!.version).toBe(1);
    expect([...same!.jpeg]).toEqual([...x]);

    const y = noise(50_000, 2);
    expect(await saveThumbnail(db, editor, id, 2, y)).toEqual({ saved: true });
    expect(await chunk()).not.toBe(first);
    expect([...(await readThumbnail(db, viewer, id))!.jpeg]).toEqual([...y]);
  });

  it("a viewer cannot save a picture", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    await expect(saveThumbnail(db, viewer, id, 2, JPEG)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Your role doesn't allow this.",
    });
    expect(await readThumbnail(db, viewer, id)).toBeNull();
  });

  it("only a JPEG of at most 300 KB is kept", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    for (const bytes of [new Uint8Array([0x89, 0x50, 0x4e, 0x47]), new Uint8Array()]) {
      await expect(saveThumbnail(db, editor, id, 2, bytes)).rejects.toMatchObject({
        code: "INVALID",
        message: "A thumbnail must be a JPEG.",
      });
    }
    await expect(saveThumbnail(db, editor, id, 2, jpegOf(307_201))).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: "A thumbnail can be at most 300 KB.",
    });
    expect(await saveThumbnail(db, editor, id, 2, jpegOf(307_200))).toEqual({ saved: true });
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xfe]))).toBe(false);
  });

  it("the role is checked first, then the size, then the type", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    await expect(saveThumbnail(db, viewer, id, 2, new Uint8Array([0x89]))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveThumbnail(db, editor, id, 2, new Uint8Array(307_201))).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
  });

  it("a project's picture version is listed and opened with it, never its bytes", async () => {
    const db = await makeTestDb();
    const id = await projectAtVersion2(db);
    expect((await listProjects(db, viewer))[0].thumbnailVersion).toBeNull();
    expect((await getProject(db, viewer, id))!.thumbnailVersion).toBeNull();
    await saveThumbnail(db, editor, id, 2, JPEG);
    const list = await listProjects(db, viewer);
    const record = (await getProject(db, viewer, id))!;
    expect(list[0].thumbnailVersion).toBe(2);
    expect(record.thumbnailVersion).toBe(2);
    expect(Object.keys(list[0])).not.toContain("thumbnail");
    expect("thumbnail" in record).toBe(false);
  });

  it("a copy keeps a current picture as version 0, and leaves an old one behind", async () => {
    const db = await makeTestDb();
    const a = await projectAtVersion2(db, "A");
    await saveThumbnail(db, editor, a, 2, JPEG);
    const copyOfA = await duplicateProject(db, editor, a);
    expect((await listProjects(db, viewer)).find((p) => p.id === copyOfA.id)).toMatchObject({ thumbnailVersion: 0 });
    const read = await readThumbnail(db, viewer, copyOfA.id);
    expect(read!.version).toBe(0);
    expect([...read!.jpeg]).toEqual([...JPEG]);

    const b = await projectAtVersion2(db, "B");
    await saveThumbnail(db, editor, b, 1, JPEG);
    const copyOfB = await duplicateProject(db, editor, b);
    expect((await listProjects(db, viewer)).find((p) => p.id === copyOfB.id)).toMatchObject({ thumbnailVersion: null });
    expect(await readThumbnail(db, viewer, copyOfB.id)).toBeNull();
    // The old picture's bytes are not stored with the copy either.
    expect(
      rowsOf(await db.execute(sql`select thumbnail is null as empty from projects where id = ${copyOfB.id}`)),
    ).toEqual([{ empty: true }]);
  });
});
