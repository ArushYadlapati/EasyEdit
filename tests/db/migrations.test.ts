import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rowsOf } from "@/db";
import { AFTER_COMING_FORWARD, BEFORE_GOING_BACK, CUSTOM_AFTER_COMING_FORWARD, REFILL_PROJECT_SIZES } from "@/db/refill-project-sizes";
import { projects } from "@/db/schema";
import { makeTestDb } from "../helpers/db";

describe("migrations", () => {
  it("migrations create all tables", async () => {
    const db = await makeTestDb();
    const r = await db.execute(
      sql`select table_name from information_schema.tables where table_schema='public' order by 1`,
    );
    expect(rowsOf<{ table_name: string }>(r).map((x) => x.table_name)).toEqual(
      expect.arrayContaining(["account", "allowlist", "assets", "folders", "project_ops", "project_opens", "project_presence", "projects", "session", "user", "verification"]),
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

  it("one row per project, person and tab; rows go when the project or the user is hard-deleted", async () => {
    const db = await makeTestDb();
    await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Sam', 'sam@example.com'), ('u2', 'Kit', 'kit@example.com')`);
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by) values ('p1', 'P', 'short_9x16', '{}', 'u1', 'u1'), ('p2', 'P', 'short_9x16', '{}', 'u1', 'u1')`);
    const share = (projectId: string, userId: string, tabId: string) =>
      db.execute(sql`insert into project_presence (project_id, user_id, tab_id, clip_ids) values (${projectId}, ${userId}, ${tabId}, '[]')`);
    await share("p1", "u1", "tab-1");
    await share("p1", "u1", "tab-2");
    await share("p1", "u2", "tab-1");
    await share("p2", "u1", "tab-1");
    await expect(share("p1", "u1", "tab-1")).rejects.toThrow();
    await expect(share("p9", "u1", "tab-1")).rejects.toThrow();
    await expect(share("p1", "u9", "tab-1")).rejects.toThrow();
    const rows = async () =>
      rowsOf(await db.execute(sql`select project_id, user_id, tab_id from project_presence order by project_id, user_id, tab_id`));
    const [row] = rowsOf<{ left_at: unknown; seen: boolean }>(
      await db.execute(sql`select left_at, seen_at is not null and changed_at is not null as seen from project_presence limit 1`),
    );
    expect(row).toEqual({ left_at: null, seen: true });
    await db.execute(sql`delete from projects where id = 'p1'`);
    expect(await rows()).toEqual([{ project_id: "p2", user_id: "u1", tab_id: "tab-1" }]);
    await db.execute(sql`delete from "user" where id = 'u1'`);
    expect(await rows()).toEqual([]);
  });

  it("journal when values strictly increase with idx", () => {
    // The migrator skips a migration older than the newest one a database has run, so a branch's migration must be
    // regenerated after merging main.
    const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; when: number }[] };
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    for (let i = 1; i < entries.length; i++) expect(entries[i].when).toBeGreaterThan(entries[i - 1].when);
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

  it("the after-deploy refill fixes empty and stale sizes, can run twice, and is in the deploy guide", async () => {
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
    expect(readFileSync("docs/deploy.md", "utf8")).toContain(REFILL_PROJECT_SIZES);
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

    const readme = readFileSync("docs/deploy.md", "utf8");
    expect(readme).toContain(BEFORE_GOING_BACK);
    expect(readme).toContain(CUSTOM_AFTER_COMING_FORWARD);
    expect(readme).toContain(AFTER_COMING_FORWARD);
  });

  it("projects has a nullable bytea thumbnail and an integer thumbnail_version", async () => {
    const db = await makeTestDb();
    const r = await db.execute(sql`select column_name, data_type, is_nullable from information_schema.columns where table_name = 'projects' and column_name in ('thumbnail', 'thumbnail_version') order by column_name`);
    expect(rowsOf(r)).toEqual([
      { column_name: "thumbnail", data_type: "bytea", is_nullable: "YES" },
      { column_name: "thumbnail_version", data_type: "integer", is_nullable: "YES" },
    ]);
  });

  it("migration 0008 only adds the two columns", () => {
    const file = readFileSync("drizzle/0008_project_thumbnails.sql", "utf8");
    expect(file.split("--> statement-breakpoint").map((s) => s.trim())).toEqual([
      'ALTER TABLE "projects" ADD COLUMN "thumbnail" "bytea";',
      'ALTER TABLE "projects" ADD COLUMN "thumbnail_version" integer;',
    ]);
  });

  it("a thumbnail reads back as the same bytes, from bytes or from hex text", async () => {
    const db = await makeTestDb();
    await db.execute(sql`insert into projects (id, name, format, doc, created_by, updated_by) values ('p1', 'P', 'short_9x16', '{}', 'u', 'u')`);
    await db.update(projects).set({ thumbnail: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), thumbnailVersion: 0 });
    const [row] = await db.select({ thumbnail: projects.thumbnail, thumbnailVersion: projects.thumbnailVersion }).from(projects);
    expect([...row.thumbnail!]).toEqual([255, 216, 255, 224]);
    expect(row.thumbnail!.buffer).toBeInstanceOf(ArrayBuffer);
    expect(row.thumbnailVersion).toBe(0);

    // A table's column is typed as a plain PgColumn, whose mapFromDriverValue returns unknown.
    const fromDriver = (value: Uint8Array | string) => projects.thumbnail.mapFromDriverValue(value) as Uint8Array;
    expect([...fromDriver("\\xffd8ff")]).toEqual([255, 216, 255]);

    // neon-http hands back a Buffer, and a small Buffer is a slice of a shared pool.
    const out = fromDriver(Buffer.from([0xff, 0xd8, 0xff]));
    expect([...out]).toEqual([255, 216, 255]);
    expect(Object.getPrototypeOf(out)).toBe(Uint8Array.prototype);
    expect(out.byteOffset).toBe(0);
    expect(out.buffer.byteLength).toBe(3);
  });

  it("has the passkey table, removed with its user", async () => {
    const db = await makeTestDb();
    const columns = rowsOf<{ column_name: string; data_type: string; is_nullable: string }>(
      await db.execute(sql`select column_name, data_type, is_nullable from information_schema.columns where table_name = 'passkey' order by column_name`),
    );
    expect(columns).toEqual([
      { column_name: "aaguid", data_type: "text", is_nullable: "YES" },
      { column_name: "backed_up", data_type: "boolean", is_nullable: "NO" },
      { column_name: "counter", data_type: "integer", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp without time zone", is_nullable: "YES" },
      { column_name: "credential_id", data_type: "text", is_nullable: "NO" },
      { column_name: "device_type", data_type: "text", is_nullable: "NO" },
      { column_name: "id", data_type: "text", is_nullable: "NO" },
      { column_name: "name", data_type: "text", is_nullable: "YES" },
      { column_name: "public_key", data_type: "text", is_nullable: "NO" },
      { column_name: "transports", data_type: "text", is_nullable: "YES" },
      { column_name: "user_id", data_type: "text", is_nullable: "NO" },
    ]);
    const indexes = rowsOf<{ indexname: string }>(await db.execute(sql`select indexname from pg_indexes where tablename = 'passkey'`)).map((r) => r.indexname);
    expect(indexes).toEqual(expect.arrayContaining(["passkey_userId_idx", "passkey_credentialID_idx"]));

    await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Ann', 'ann@example.com'), ('u2', 'Bob', 'bob@example.com')`);
    const add = (id: string, userId: string) =>
      db.execute(sql`insert into passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up)
        values (${id}, 'Passkey', 'key', ${userId}, ${`cred-${id}`}, 0, 'multiDevice', true)`);
    await add("k1", "u1");
    await add("k2", "u1");
    await add("k3", "u2");
    await expect(add("k4", "nobody")).rejects.toThrow();
    // A credential id belongs to one passkey: sign-in looks a passkey up by it alone.
    await expect(db.execute(sql`insert into passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up)
      values ('k5', 'Passkey', 'other key', 'u2', 'cred-k1', 0, 'multiDevice', true)`)).rejects.toThrow();
    await db.execute(sql`delete from "user" where id = 'u1'`);
    expect(rowsOf(await db.execute(sql`select id, user_id from passkey order by id`))).toEqual([{ id: "k3", user_id: "u2" }]);
  });

  it("migration 0009 only creates the passkey table, its foreign key and two indexes", () => {
    const statements = readFileSync("drizzle/0009_passkeys.sql", "utf8").split("--> statement-breakpoint").map((s) => s.trim());
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatch(/^CREATE TABLE "passkey" \(/);
    expect(statements[1]).toMatch(/^ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY \("user_id"\) REFERENCES "public"\."user"\("id"\) ON DELETE cascade/);
    expect(statements.slice(2).sort()).toEqual([
      'CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");',
      'CREATE UNIQUE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");',
    ]);
  });

  it("the deploy guide says to migrate before deploying, and that 0007 may run with it", () => {
    expect(readFileSync("docs/deploy.md", "utf8")).toContain(
      "    **Before deploying the version with project pictures:** run the migration against the production database first, with the command above, then deploy. Until it has run, that version's dashboard, editor, project API and Claude's tools fail. On its own it only adds two empty columns, which the version that is live now ignores. If the migration for folders and custom sizes has not run yet, the same command runs both together, so follow that paragraph too: run it at a quiet time, and run its statement after the deploy.",
    );
  });
});
