import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { checkAppBudget, checkFolderCap } from "@/lib/app-budget";
import { LIMITS, type Limits } from "@/lib/limits";
import { agentActorIdsOf } from "@/lib/projects/display-actor";

const MSG = {
  day: "Today's limit for saved changes is used up (20 MB a day). It frees up over the next 24 hours.",
  minute: "Too many changes at once. Wait a minute, then keep going.",
  project: "You've reached today's limit for new projects (25). It frees up over the next 24 hours.",
  upload: "You've reached today's limit for uploads (500). It frees up over the next 24 hours.",
  folder: "A space can have up to 200 folders.",
};
const lim = (o: Partial<Limits>): Limits => ({ ...LIMITS, ...o });
const refused = (p: Promise<void>, message: string) =>
  expect(p).rejects.toMatchObject({ name: "ServiceError", code: "LIMIT_EXCEEDED", status: 400, message });

let db: DB;
let n = 0;
beforeEach(async () => {
  const { makeTestDb } = await import("../helpers/db");
  db = await makeTestDb();
  n = 0;
  await db.execute(sql`insert into organization (id, name, slug, created_at, kind) values ('team_a', 'A', 'a', now(), 'team'), ('team_b', 'B', 'b', now(), 'team')`);
  await db.execute(sql`insert into projects (id, space_id, name, format, doc, created_by, updated_by) values ('p0', 'team_a', 'P', 'short_9x16', '{}', 'seed', 'seed')`);
});

const opRow = (actor: string, ago = "0 seconds", ops = "[]") =>
  db.execute(sql`insert into project_ops (project_id, version, ops, inverse, actor, created_at)
    values ('p0', ${++n}, ${ops}::jsonb, '[]'::jsonb, ${actor}, now() - ${ago}::interval)`);
const project = (by: string, ago = "0 seconds", deleted = false) =>
  db.execute(sql`insert into projects (id, space_id, name, format, doc, created_by, updated_by, created_at, deleted_at)
    values (${`p${++n}`}, 'team_a', 'P', 'short_9x16', '{}', ${by}, ${by}, now() - ${ago}::interval, ${deleted ? sql`now()` : null})`);
const asset = (by: string, ago = "0 seconds", removed = false) =>
  db.execute(sql`insert into assets (id, space_id, kind, name, file_name, mime_type, size_bytes, last_modified_ms, uploaded_by, created_at, removed_at)
    values (${`a${++n}`}, 'team_a', 'video', 'v', ${`v${n}.mp4`}, 'video/mp4', 1, 1, ${by}, now() - ${ago}::interval, ${removed ? sql`now()` : null})`);
const folder = (space: string) =>
  db.execute(sql`insert into folders (id, space_id, name, created_by) values (${`f${++n}`}, ${space}, ${`f${n}`}, 'u1')`);

describe("checkAppBudget edit", () => {
  it("passes under both limits", async () => {
    await opRow("u1");
    await expect(checkAppBudget(db, "u1", "edit", lim({ appEditsPerMinute: 2 }))).resolves.toBeUndefined();
  });
  it("refuses at the per-minute limit", async () => {
    await opRow("u1"); await opRow("u1");
    await refused(checkAppBudget(db, "u1", "edit", lim({ appEditsPerMinute: 2 })), MSG.minute);
  });
  it("refuses at the per-day byte limit", async () => {
    await opRow("u1", "2 hours");
    await refused(checkAppBudget(db, "u1", "edit", lim({ appEditBytesPerDay: 1 })), MSG.day);
  });
  it("checks the minute first", async () => {
    await opRow("u1");
    await refused(checkAppBudget(db, "u1", "edit", lim({ appEditsPerMinute: 1, appEditBytesPerDay: 1 })), MSG.minute);
  });
  it("ignores edits older than a minute for the rate and older than a day for bytes", async () => {
    await opRow("u1", "2 minutes");
    await expect(checkAppBudget(db, "u1", "edit", lim({ appEditsPerMinute: 1 }))).resolves.toBeUndefined();
    await opRow("u1", "25 hours");
    await expect(checkAppBudget(db, "u1", "edit", lim({ appEditBytesPerDay: 1 + 200 }))).resolves.toBeUndefined();
  });
  it("does not count the person's AI agents", async () => {
    for (const id of agentActorIdsOf("u1")) await opRow(id);
    await expect(checkAppBudget(db, "u1", "edit", lim({ appEditsPerMinute: 1, appEditBytesPerDay: 1 }))).resolves.toBeUndefined();
  });
  it("does not count another member", async () => {
    await opRow("u2"); await opRow("u2");
    await expect(checkAppBudget(db, "u1", "edit", lim({ appEditsPerMinute: 1, appEditBytesPerDay: 1 }))).resolves.toBeUndefined();
  });
});

describe("checkAppBudget project and upload", () => {
  it("passes under the limit, refuses at it, deleted projects count", async () => {
    await project("u1", "0 seconds", true);
    await expect(checkAppBudget(db, "u1", "project", lim({ appProjectsPerDay: 2 }))).resolves.toBeUndefined();
    await project("u1");
    await refused(checkAppBudget(db, "u1", "project", lim({ appProjectsPerDay: 2 })), MSG.project);
  });
  it("ignores old, other-person and agent-made projects", async () => {
    await project("u1", "25 hours"); await project("u2");
    await project(agentActorIdsOf("u1")[0]);
    await expect(checkAppBudget(db, "u1", "project", lim({ appProjectsPerDay: 1 }))).resolves.toBeUndefined();
  });
  it("uploads: refuses at the limit, removed ones count, old ones do not", async () => {
    await asset("u1", "25 hours");
    await asset("u1", "0 seconds", true);
    await expect(checkAppBudget(db, "u1", "upload", lim({ appUploadsPerDay: 2 }))).resolves.toBeUndefined();
    await asset("u1"); await asset("u2");
    await refused(checkAppBudget(db, "u1", "upload", lim({ appUploadsPerDay: 2 })), MSG.upload);
  });
});

describe("checkFolderCap", () => {
  it("passes under the cap and refuses at it, per space", async () => {
    await folder("team_a"); await folder("team_b");
    await expect(checkFolderCap(db, "team_a", lim({ foldersPerSpace: 2 }))).resolves.toBeUndefined();
    await folder("team_a");
    await refused(checkFolderCap(db, "team_a", lim({ foldersPerSpace: 2 })), MSG.folder);
    await expect(checkFolderCap(db, "team_b", lim({ foldersPerSpace: 2 }))).resolves.toBeUndefined();
  });
});
