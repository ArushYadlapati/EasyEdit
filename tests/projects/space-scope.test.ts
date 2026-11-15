import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkIn } from "@/lib/projects/presence";
import { createFolder, listFolders, moveProject } from "@/lib/projects/folders";
import { listRecentProjectIds, recordOpen } from "@/lib/projects/opens";
import {
  applyProjectOps,
  createProject,
  deleteProject,
  duplicateProject,
  getOpsSince,
  getProject,
  getProjectVersion,
  listProjects,
  renameProject,
} from "@/lib/projects/service";
import { readThumbnail, saveThumbnail } from "@/lib/projects/thumbnails";
import { personalSpaceId } from "@/lib/spaces/types";
import { DEFAULT_TRANSFORM, type OpInput } from "@/lib/timeline";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

// u1 has a personal space and is in the team; u2 is only in the team.
async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  await joinSpace(db, { id: "u2" }, "editor");
  const u1Team = testActor({ userId: "u1", role: "editor" });
  const u1Personal = testActor({ userId: "u1", role: "admin", spaceId: personalSpaceId("u1") });
  const u2Team = testActor({ userId: "u2", email: "u2@gmail.com", role: "editor" });
  return { db, u1Team, u1Personal, u2Team };
}

const addClip = {
  op: "add_clip",
  trackId: "t1",
  clip: { id: "c1", type: "text", start: 0, duration: 60, text: "x", transform: { ...DEFAULT_TRANSFORM }, style: { fontFamily: "Inter", fontSize: 96, fontWeight: 800, color: "#FFFFFF", align: "center" } },
} as OpInput;

describe("projects are scoped to the actor's space", () => {
  it("cross-space ids answer as missing", async () => {
    const { db, u1Personal, u2Team } = await setup();
    const { id } = await createProject(db, u1Personal, { name: "Mine", format: "short_9x16" });
    await saveThumbnail(db, u1Personal, id, 0, JPEG);
    expect(await getProject(db, u2Team, id)).toBeNull();
    expect(await getProjectVersion(db, u2Team, id)).toBeNull();
    expect(await getOpsSince(db, u2Team, id, 0)).toBeNull();
    expect(await readThumbnail(db, u2Team, id)).toBeNull();
    expect(await checkIn(db, u2Team, id, null)).toBeNull();
    expect(await checkIn(db, u2Team, id, { tabId: "tab-12345678", clipIds: [], trackId: null, changedAgoMs: 0 })).toBeNull();
    expect(await saveThumbnail(db, u2Team, id, 0, JPEG)).toEqual({ saved: false });
    await expect(renameProject(db, u2Team, id, "X")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteProject(db, u2Team, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(duplicateProject(db, u2Team, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(applyProjectOps(db, u2Team, { projectId: id, baseVersion: 0, ops: [addClip] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await recordOpen(db, u2Team, id);
    expect(await listRecentProjectIds(db, u2Team)).toEqual([]);
    // Nothing changed for the owner.
    expect((await getProject(db, u1Personal, id))?.name).toBe("Mine");
    expect(await getProjectVersion(db, u1Personal, id)).toBe(0);
  });

  it("lists show only the actor's space", async () => {
    const { db, u1Team, u1Personal } = await setup();
    const t = await createProject(db, u1Team, { name: "Team one", format: "short_9x16" });
    const p = await createProject(db, u1Personal, { name: "Mine", format: "short_9x16" });
    await createFolder(db, u1Team, "Team folder");
    await createFolder(db, u1Personal, "Mine folder");
    await recordOpen(db, u1Team, t.id);
    await recordOpen(db, u1Personal, p.id);
    expect((await listProjects(db, u1Team)).map((x) => x.id)).toEqual([t.id]);
    expect((await listProjects(db, u1Personal)).map((x) => x.id)).toEqual([p.id]);
    expect((await listFolders(db, u1Team)).map((f) => f.name)).toEqual(["Team folder"]);
    expect((await listFolders(db, u1Personal)).map((f) => f.name)).toEqual(["Mine folder"]);
    expect(await listRecentProjectIds(db, u1Team)).toEqual([t.id]);
    expect(await listRecentProjectIds(db, u1Personal)).toEqual([p.id]);
  });

  it("folder names are unique per space", async () => {
    const { db, u1Team, u1Personal } = await setup();
    await createFolder(db, u1Team, "Season");
    await createFolder(db, u1Personal, "Season");
    await expect(createFolder(db, u1Team, "season")).rejects.toMatchObject({ code: "CONFLICT", status: 409, message: "There's already a folder with that name." });
  });

  it("folders of another space are refused", async () => {
    const { db, u1Team, u1Personal } = await setup();
    const folder = await createFolder(db, u1Personal, "Mine");
    await expect(createProject(db, u1Team, { name: "P", format: "short_9x16", folderId: folder.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listProjects(db, u1Team)).toEqual([]);
    const project = await createProject(db, u1Team, { name: "P", format: "short_9x16" });
    await expect(moveProject(db, u1Team, project.id, folder.id)).rejects.toMatchObject({ code: "NOT_FOUND", message: "That folder no longer exists." });
    await expect(moveProject(db, u1Personal, project.id, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("another space's folder cannot be renamed or deleted", async () => {
    const { db, u1Team, u1Personal } = await setup();
    const folder = await createFolder(db, u1Personal, "Mine");
    const { renameFolder, deleteFolder } = await import("@/lib/projects/folders");
    await expect(renameFolder(db, u1Team, folder.id, "X")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFolder(db, u1Team, folder.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("duplicate stays in the source space", async () => {
    const { db, u1Personal } = await setup();
    const { id } = await createProject(db, u1Personal, { name: "Mine", format: "short_9x16" });
    const copy = await duplicateProject(db, u1Personal, id);
    const rows = (await db.execute(sql`select space_id from projects where id = ${copy.id}`)) as unknown as { rows?: { space_id: string }[] } & { space_id: string }[];
    const spaceId = (rows.rows ?? rows)[0].space_id;
    expect(spaceId).toBe(personalSpaceId("u1"));
    expect((await listProjects(db, u1Personal)).map((p) => p.id).sort()).toEqual([id, copy.id].sort());
  });
});
