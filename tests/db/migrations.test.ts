import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf } from "@/db";
import { AFTER_COMING_FORWARD, BEFORE_GOING_BACK, CUSTOM_AFTER_COMING_FORWARD, REFILL_PROJECT_SIZES } from "@/db/refill-project-sizes";
import { makeTestDb } from "../helpers/db";

describe("migrations", () => {
  it("migrations create all tables", async () => {
    const db = await makeTestDb();
    const r = await db.execute(
      sql`select table_name from information_schema.tables where table_schema='public' order by 1`,
    );
    expect(rowsOf<{ table_name: string }>(r).map((x) => x.table_name)).toEqual(
      expect.arrayContaining(["account", "allowlist", "assets", "folders", "project_ops", "project_opens", "projects", "session", "user", "verification"]),
    );
  });

  it("project_ops has a nullable jsonb inverse column", async () => {
    const db = await makeTestDb();
    const r = await db.execute(sql`select data_type, is_nullable from information_schema.columns where table_name = 'project_ops' and column_name = 'inverse'`);
    expect(rowsOf(r)).toEqual([{ data_type: "jsonb", is_nullable: "YES" }]);
  });

  it("projects has a nullable deleted_at timestamp column", async () => {
    const db = await makeTestDb();
    const r = await db.execute(sql`select data_type, is_nullable from information_schema.columns where table_name = 'projects' and column_name = 'deleted_at'`);
    expect(rowsOf(r)).toEqual([{ data_type: "timestamp without time zone", is_nullable: "YES" }]);
  });

  it("project_ops has a nullable request_id, unique per project", async () => {
    const db = await makeTestDb();
    const column = await db.execute(sql`select data_type, is_nullable from information_schema.columns where table_name = 'project_ops' and column_name = 'request_id'`);
    expect(rowsOf(column)).toEqual([{ data_type: "text", is_nullable: "YES" }]);
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by) values ('p1', 'P', 'short_9x16', '{}', 'u', 'u'), ('p2', 'P', 'short_9x16', '{}', 'u', 'u')`);
    const log = (project: string, version: number, requestId: string | null) =>
      db.execute(sql`insert into project_ops (project_id, version, ops, actor, request_id) values (${project}, ${version}, '[]', 'u', ${requestId})`);
    await log("p1", 1, null);
    await log("p1", 2, null);
    await log("p1", 3, "req-0001");
    await log("p2", 1, "req-0001");
    await expect(log("p1", 4, "req-0001")).rejects.toThrow();
  });

  it("the allowlist only stores trimmed, lowercase emails", async () => {
    const db = await makeTestDb();
    for (const email of ["Kid@gmail.com", " kid@gmail.com"]) {
      await expect(db.execute(sql`insert into allowlist (email, role) values (${email}, 'viewer')`)).rejects.toThrow();
    }
    await db.execute(sql`insert into allowlist (email, role) values ('kid@gmail.com', 'viewer')`);
    expect(rowsOf(await db.execute(sql`select email from allowlist`))).toEqual([{ email: "kid@gmail.com" }]);
  });

  it("has the tables the connector's sign-in needs, and the index the write budget reads", async () => {
    const db = await makeTestDb();
    const tables = rowsOf<{ table_name: string }>(await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`)).map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining([
      "jwks", "oauth_client", "oauth_resource", "oauth_client_resource", "oauth_refresh_token",
      "oauth_access_token", "oauth_consent", "oauth_client_assertion", "rate_limit",
    ]));
    const indexes = rowsOf<{ indexname: string }>(await db.execute(sql`select indexname from pg_indexes where tablename = 'project_ops'`)).map((r) => r.indexname);
    expect(indexes).toContain("project_ops_actor_created_at_idx");
  });

  it("assets holds one unfinished upload per member and file, and only the kinds and states it knows", async () => {
    const db = await makeTestDb();
    const columns = rowsOf<{ column_name: string; data_type: string }>(
      await db.execute(sql`select column_name, data_type from information_schema.columns where table_name = 'assets' and column_name in ('size_bytes', 'last_modified_ms', 'fps')`),
    );
    expect(Object.fromEntries(columns.map((c) => [c.column_name, c.data_type]))).toEqual({ size_bytes: "bigint", last_modified_ms: "bigint", fps: "real" }); // a file may be 2 GB
    const indexes = rowsOf<{ indexname: string }>(await db.execute(sql`select indexname from pg_indexes where tablename = 'assets'`)).map((r) => r.indexname);
    expect(indexes).toEqual(expect.arrayContaining(["assets_unfinished_upload_unique", "assets_created_at_idx"]));

    const add = (id: string, over: { kind?: string; status?: string; previewStatus?: string; uploadedBy?: string; sizeBytes?: number } = {}) =>
      db.execute(sql`insert into assets (id, kind, name, file_name, mime_type, size_bytes, last_modified_ms, status, preview_status, uploaded_by)
        values (${id}, ${over.kind ?? "video"}, 'Clip', 'clip.mp4', 'video/mp4', ${over.sizeBytes ?? 2_147_483_648}, 1762800000000, ${over.status ?? "uploading"}, ${over.previewStatus ?? "none"}, ${over.uploadedBy ?? "u1"})`);
    await add("a1");
    await expect(add("a2")).rejects.toThrow(); // the same member, the same file, both unfinished
    await add("a3", { uploadedBy: "u2" });
    await add("a4", { sizeBytes: 5 });
    await add("a5", { status: "ready" });
    await add("a6", { status: "ready" }); // any number of finished copies
    await expect(add("a7", { kind: "gif" })).rejects.toThrow();
    await expect(add("a8", { status: "done", uploadedBy: "u3" })).rejects.toThrow();
    await expect(add("a9", { previewStatus: "soon", uploadedBy: "u3" })).rejects.toThrow();
    const [row] = rowsOf<{ status: string; preview_status: string; has_audio: boolean }>(
      await db.execute(sql`insert into assets (id, kind, name, file_name, mime_type, size_bytes, last_modified_ms, uploaded_by) values ('b1', 'image', 'Field', 'field.jpg', 'image/jpeg', 1, 1, 'u9') returning status, preview_status, has_audio`),
    );
    expect(row).toEqual({ status: "uploading", preview_status: "none", has_audio: false });
  });

  it("projects has nullable folder_id, width and height", async () => {
    const db = await makeTestDb();
    const r = await db.execute(sql`select column_name, data_type, is_nullable from information_schema.columns where table_name = 'projects' and column_name in ('folder_id', 'width', 'height') order by column_name`);
    expect(rowsOf(r)).toEqual([
      { column_name: "folder_id", data_type: "text", is_nullable: "YES" },
      { column_name: "height", data_type: "integer", is_nullable: "YES" },
      { column_name: "width", data_type: "integer", is_nullable: "YES" },
    ]);
  });

  it("folder names are unique regardless of case", async () => {
    const db = await makeTestDb();
    await db.execute(sql`insert into folders (id, name, created_by) values ('f1', 'Season 2026', 'u')`);
    await expect(db.execute(sql`insert into folders (id, name, created_by) values ('f2', 'season 2026', 'u')`)).rejects.toThrow();
    await db.execute(sql`insert into folders (id, name, created_by) values ('f3', 'Sponsors', 'u')`);
    expect(rowsOf(await db.execute(sql`select id from folders order by id`))).toEqual([{ id: "f1" }, { id: "f3" }]);
  });

  it("deleting a folder keeps its projects, in no folder", async () => {
    const db = await makeTestDb();
    await db.execute(sql`insert into folders (id, name, created_by) values ('f1', 'Season 2026', 'u')`);
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by, folder_id) values ('p1', 'P', 'short_9x16', '{}', 'u', 'u', 'f1')`);
    await db.execute(sql`delete from folders where id = 'f1'`);
    expect(rowsOf(await db.execute(sql`select id, folder_id from projects`))).toEqual([{ id: "p1", folder_id: null }]);
  });

  it("project_opens is one row per person and project, and goes with either", async () => {
    const db = await makeTestDb();
    await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Sam', 'sam@example.com')`);
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by) values ('p1', 'P', 'short_9x16', '{}', 'u1', 'u1'), ('p2', 'P', 'short_9x16', '{}', 'u1', 'u1')`);
    const open = (projectId: string) => db.execute(sql`insert into project_opens (user_id, project_id) values ('u1', ${projectId})`);
    await open("p1");
    await open("p2");
    await expect(open("p1")).rejects.toThrow();
    const opens = async () => rowsOf(await db.execute(sql`select user_id, project_id from project_opens order by project_id`));
    await db.execute(sql`delete from projects where id = 'p1'`);
    expect(await opens()).toEqual([{ user_id: "u1", project_id: "p2" }]);
    await db.execute(sql`delete from "user" where id = 'u1'`);
    expect(await opens()).toEqual([]);
  });

  it("the migration's last statement fills width and height from each doc", async () => {
    const file = readFileSync("drizzle/0007_project_folders.sql", "utf8");
    expect(file).not.toMatch(/\bDROP\b/);
    expect(file).not.toMatch(/"(width|height)" integer NOT NULL/);
    const last = file.split("--> statement-breakpoint").at(-1)!.trim();
    expect(last.startsWith('UPDATE "projects" SET "width"')).toBe(true);
    const db = await makeTestDb();
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by) values ('p1', 'P', 'custom', '{"width":816,"height":1056}', 'u', 'u')`);
    await db.execute(sql.raw(last));
    expect(rowsOf(await db.execute(sql`select width, height from projects`))).toEqual([{ width: 816, height: 1056 }]);
  });

  it("the after-deploy refill fixes empty and stale sizes, can run twice, and is in the README", async () => {
    const db = await makeTestDb();
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by, width, height) values
      ('a', 'A', 'short_9x16', '{"width":1080,"height":1920}', 'u', 'u', null, null),
      ('b', 'B', 'custom', '{"width":816,"height":1056}', 'u', 'u', 1, 1),
      ('c', 'C', 'long_16x9', '{"width":1920,"height":1080}', 'u', 'u', 1920, 1080)`);
    const sizes = async () => rowsOf(await db.execute(sql`select id, width, height from projects order by id`));
    const fixed = [
      { id: "a", width: 1080, height: 1920 },
      { id: "b", width: 816, height: 1056 },
      { id: "c", width: 1920, height: 1080 },
    ];
    const first = await db.execute(sql.raw(REFILL_PROJECT_SIZES));
    expect((first as unknown as { affectedRows: number }).affectedRows).toBe(2);
    expect(await sizes()).toEqual(fixed);
    const second = await db.execute(sql.raw(REFILL_PROJECT_SIZES));
    expect((second as unknown as { affectedRows: number }).affectedRows).toBe(0);
    expect(await sizes()).toEqual(fixed);
    expect(readFileSync("README.md", "utf8")).toContain(REFILL_PROJECT_SIZES);
  });

  it("going back keeps the earlier version's writes off custom, and coming forward brings custom sizes back", async () => {
    const db = await makeTestDb();
    const p1doc = { format: "custom", width: 816, height: 1056, tracks: [] };
    const p2doc = { format: "custom", width: 384, height: 576, tracks: [] };
    const p3doc = { format: "long_16x9", width: 1920, height: 1080, tracks: [] };
    const p4doc = { format: "short_9x16", width: 1080, height: 1920, tracks: [] };
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by) values
      ('p1', 'P1', 'custom', ${JSON.stringify(p1doc)}, 'u', 'u'),
      ('p2', 'P2', 'long_16x9', ${JSON.stringify(p2doc)}, 'u', 'u'),
      ('p3', 'P3', 'long_16x9', ${JSON.stringify(p3doc)}, 'u', 'u'),
      ('p4', 'P4', 'short_9x16', ${JSON.stringify(p4doc)}, 'u', 'u')`);
    const rows = async () =>
      rowsOf<{ id: string; format: string; doc: unknown }>(await db.execute(sql`select id, format, doc from projects order by id`)).map((r) => [r.id, r.format, r.doc]);
    const affected = (result: unknown) => (result as { affectedRows: number }).affectedRows;

    await db.execute(sql.raw(BEFORE_GOING_BACK));
    // The earlier version sets the column from the timeline on every op write.
    await db.execute(sql`update projects set format = doc->>'format'`);
    expect(await rows()).toEqual([
      ["p1", "long_16x9", { ...p1doc, format: "long_16x9" }],
      ["p2", "long_16x9", { ...p2doc, format: "long_16x9" }],
      ["p3", "long_16x9", p3doc],
      ["p4", "short_9x16", p4doc],
    ]);

    await db.execute(sql.raw(CUSTOM_AFTER_COMING_FORWARD));
    await db.execute(sql.raw(AFTER_COMING_FORWARD));
    const back = [
      ["p1", "custom", p1doc],
      ["p2", "custom", p2doc],
      ["p3", "long_16x9", p3doc],
      ["p4", "short_9x16", p4doc],
    ];
    expect(await rows()).toEqual(back);
    expect(affected(await db.execute(sql.raw(CUSTOM_AFTER_COMING_FORWARD)))).toBe(0);
    expect(affected(await db.execute(sql.raw(AFTER_COMING_FORWARD)))).toBe(0);
    expect(await rows()).toEqual(back);

    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain(BEFORE_GOING_BACK);
    expect(readme).toContain(CUSTOM_AFTER_COMING_FORWARD);
    expect(readme).toContain(AFTER_COMING_FORWARD);
  });
});
