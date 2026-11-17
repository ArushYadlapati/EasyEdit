import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets, folders, projectMove, projectOps, projectPins, projects } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { DriveError } from "@/lib/drive/token";
import { listAssets } from "@/lib/media/service";
import { finishMove, startMove, type MoveDeps } from "@/lib/projects/move";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { applyProjectOps, getProject } from "@/lib/projects/service";
import type { ServiceError } from "@/lib/service-error";
import type { OpInput, TimelineDoc } from "@/lib/timeline";
import { joinSpace, testActor } from "../helpers/actor";
import { insertAsset, mediaClip } from "../media/context";
import { copyAll, copyFully, moveWorld, type MoveWorld } from "./move-world";

afterEach(() => vi.restoreAllMocks());

// An ordinary edit that touches no media.
const revolume = (volume: number): OpInput[] => [{ op: "update_clip", clipId: "c1", patch: { volume } } as OpInput];

// The world with one ordinary edit made (version 1, with its undo data), a folder and a pin, and a move to u1's personal
// space started.
async function started(x?: MoveWorld) {
  x ??= await moveWorld();
  await applyProjectOps(x.w.db, x.actor, { projectId: "p1", baseVersion: 0, ops: revolume(0.9) });
  await x.w.db.insert(folders).values({ id: "f1", spaceId: x.actor.spaceId, name: "Season", createdBy: "u1" });
  await x.w.db.update(projects).set({ folderId: "f1" }).where(eq(projects.id, "p1"));
  await x.w.db.insert(projectPins).values({ projectId: "p1", spaceId: x.actor.spaceId, pinnedBy: "u1" });
  const plan = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
  const personal: Actor = { ...x.actor, spaceId: x.w.personal };
  const row = async () => (await x.w.db.select().from(projects).where(eq(projects.id, "p1")))[0];
  const opsRows = () => x.w.db.select().from(projectOps).where(eq(projectOps.projectId, "p1")).orderBy(asc(projectOps.version));
  return { ...x, moveId: plan.moveId, personal, row, opsRows };
}

const clipsOf = (doc: TimelineDoc) => doc.tracks.flatMap((t) => t.clips);

describe("finishMove", () => {
  it("moves the project in one write onto its copies", async () => {
    const x = await started();
    const copies = await copyAll(x, "u1", x.moveId);
    const before = await x.row();
    expect(before.version).toBe(1);

    const done = await finishMove(x.deps, "u1", x.moveId);
    expect(done).toEqual({ projectId: "p1", spaceId: x.w.personal, slug: "personal", version: 2 });

    const after = await x.row();
    expect(after).toMatchObject({ spaceId: x.w.personal, folderId: null, movedAtVersion: 2, version: 2, updatedBy: "u1" });
    const byId = new Map(clipsOf(after.doc).map((c) => [c.id, c]));
    expect(byId.get("c1")).toMatchObject({ assetId: copies.get(x.a) });
    expect(byId.get("c2")).toMatchObject({ assetId: copies.get(x.a) });
    expect(byId.get("c3")).toMatchObject({ assetId: copies.get(x.b) });
    expect(byId.get("c4")).toEqual(clipsOf(before.doc).find((c) => c.id === "c4"));
    expect(await x.w.db.select().from(projectPins).where(eq(projectPins.projectId, "p1"))).toEqual([]);

    for (const [source, copy] of copies) {
      const [row] = await x.w.db.select().from(assets).where(eq(assets.id, copy));
      expect(row).toMatchObject({ moveId: null, copiedFrom: source, spaceId: x.w.personal, status: "ready" });
    }
    const listed = (await listAssets(x.w.db, x.personal)).map((a) => a.id);
    expect(listed.sort()).toEqual([...copies.values()].sort());
    const [move] = await x.w.db.select().from(projectMove).where(eq(projectMove.id, x.moveId));
    expect(move.finishedAt).not.toBeNull();
    expect(move.abandonedAt).toBeNull();

    // The originals stay in the source's library, as they were.
    const sourceListed = (await listAssets(x.w.db, x.actor)).map((a) => a.id);
    expect(sourceListed).toEqual(expect.arrayContaining([x.a, x.b]));
    const [a] = await x.w.db.select().from(assets).where(eq(assets.id, x.a));
    expect(a).toMatchObject({ spaceId: x.actor.spaceId, moveId: null, copiedFrom: null, driveFileId: "orig-a", previewFileId: "prev-a" });

    // The move is logged as its own version, with no undo, and nothing before it can be undone.
    const log = await x.opsRows();
    expect(log.map((r) => r.version)).toEqual([1, 2]);
    expect(log[1]).toMatchObject({ actor: "u1", inverse: null });
    expect(log[1].ops).toEqual([
      { op: "update_clip", clipId: "c1", patch: { assetId: copies.get(x.a) } },
      { op: "update_clip", clipId: "c2", patch: { assetId: copies.get(x.a) } },
      { op: "update_clip", clipId: "c3", patch: { assetId: copies.get(x.b) } },
    ]);
    expect(log[0].inverse).toBeNull();
  });

  it("shows the project only in its new space", async () => {
    const x = await started();
    await copyAll(x, "u1", x.moveId);
    await finishMove(x.deps, "u1", x.moveId);
    expect(await getProject(x.w.db, x.actor, "p1")).toBeNull();
    expect(await getProject(x.w.db, x.personal, "p1")).toMatchObject({ id: "p1", version: 2, movedAtVersion: 2 });
  });

  it("refuses while an asset has no copy, and changes nothing", async () => {
    const x = await started();
    await copyFully(x, "u1", x.moveId, x.a);
    const before = await x.row();
    const log = await x.opsRows();
    const refused: unknown = await finishMove(x.deps, "u1", x.moveId).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "COPIES_MISSING", status: 409, message: MOVE_MESSAGES.copiesMissing, missing: [x.b] });
    expect((refused as ServiceError).toBody()).toEqual({ code: "COPIES_MISSING", message: MOVE_MESSAGES.copiesMissing, missing: [x.b] });
    expect(await x.row()).toEqual(before);
    expect(await x.opsRows()).toEqual(log);
    expect(await x.w.db.select().from(projectPins).where(eq(projectPins.projectId, "p1"))).toHaveLength(1);
    const [move] = await x.w.db.select().from(projectMove).where(eq(projectMove.id, x.moveId));
    expect(move.finishedAt).toBeNull();
  });

  it("refuses media added after the copies, until that is copied too", async () => {
    const x = await started();
    await copyAll(x, "u1", x.moveId);
    const c = await insertAsset(x.w.db, { name: "Clip C", driveFileId: "orig-c" });
    await applyProjectOps(x.w.db, x.actor, { projectId: "p1", baseVersion: 1, ops: [{ op: "add_clip", trackId: "t-video", clip: mediaClip(c, { start: 400 }) } as OpInput] });
    await expect(finishMove(x.deps, "u1", x.moveId)).rejects.toMatchObject({ code: "COPIES_MISSING", missing: [c] });
    const copy = await copyFully(x, "u1", x.moveId, c);
    expect(await finishMove(x.deps, "u1", x.moveId)).toMatchObject({ version: 3 });
    expect(clipsOf((await x.row()).doc).map((cl) => (cl.type === "text" ? null : cl.assetId))).toContain(copy);
  });

  it("tries again when an ordinary edit lands between its read and its write", async () => {
    const x = await started();
    await copyAll(x, "u1", x.moveId);
    let edits = 0;
    const deps: MoveDeps = { ...x.deps, beforeFinishWrite: async () => {
      if (edits++ === 0) await applyProjectOps(x.w.db, x.actor, { projectId: "p1", baseVersion: 1, ops: revolume(0.5) });
    } };
    expect(await finishMove(deps, "u1", x.moveId)).toMatchObject({ version: 3 });
    expect(edits).toBe(2);
    const after = await x.row();
    expect(after).toMatchObject({ spaceId: x.w.personal, movedAtVersion: 3 });
    expect(clipsOf(after.doc).find((c) => c.id === "c1")).toMatchObject({ volume: 0.5 });
    expect((await x.opsRows()).map((r) => [r.version, r.inverse === null])).toEqual([[1, true], [2, true], [3, true]]);
  });

  it("refuses edits planned before the move, and takes ones after it", async () => {
    const x = await started();
    await copyAll(x, "u1", x.moveId);
    await finishMove(x.deps, "u1", x.moveId);
    await expect(applyProjectOps(x.w.db, x.personal, { projectId: "p1", baseVersion: 1, ops: revolume(0.4) })).rejects.toMatchObject({
      code: "MOVED", status: 409, message: MOVE_MESSAGES.moved, currentVersion: 2,
    });
    expect(await applyProjectOps(x.w.db, x.personal, { projectId: "p1", baseVersion: 2, ops: revolume(0.3) })).toMatchObject({ version: 3 });
  });

  it("answers a deleted project and a second finish as gone", async () => {
    const x = await started();
    await copyAll(x, "u1", x.moveId);
    await x.w.db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, "p1"));
    await expect(finishMove(x.deps, "u1", x.moveId)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    const y = await started();
    await copyAll(y, "u1", y.moveId);
    await finishMove(y.deps, "u1", y.moveId);
    await expect(finishMove(y.deps, "u1", y.moveId)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404, message: MOVE_MESSAGES.gone });
  });

  it("refuses once the mover can no longer edit in the destination", async () => {
    const x = await moveWorld();
    const club = await x.w.team("Club");
    await x.setUp(club);
    await applyProjectOps(x.w.db, x.actor, { projectId: "p1", baseVersion: 0, ops: revolume(0.9) });
    const plan = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: club });
    await copyAll(x, "u1", plan.moveId);
    await joinSpace(x.w.db, { id: "u1" }, "viewer", club);
    await expect(finishMove(x.deps, "u1", plan.moveId)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, message: MOVE_MESSAGES.cantEditThere("Club") });
    expect((await x.w.db.select().from(projects).where(eq(projects.id, "p1")))[0].spaceId).toBe(x.actor.spaceId);
  });

  it("brings in only the copies the project uses; the rest stay hidden for the clean-up", async () => {
    const x = await started();
    const copies = await copyAll(x, "u1", x.moveId);
    await applyProjectOps(x.w.db, x.actor, { projectId: "p1", baseVersion: 1, ops: [{ op: "remove_clip", clipId: "c3" } as OpInput] });
    await finishMove(x.deps, "u1", x.moveId);
    const [used] = await x.w.db.select().from(assets).where(eq(assets.id, copies.get(x.a)!));
    const [unused] = await x.w.db.select().from(assets).where(eq(assets.id, copies.get(x.b)!));
    expect(used.moveId).toBeNull();
    expect(unused.moveId).toBe(x.moveId);
    expect((await listAssets(x.w.db, x.personal)).map((a) => a.id)).toEqual([copies.get(x.a)]);
  });
});

describe("two people moving one project", () => {
  async function rivals() {
    const x = await moveWorld();
    const club = await x.w.team("Club");
    await x.setUp(club);
    await joinSpace(x.w.db, { id: "u2" }, "editor");
    await joinSpace(x.w.db, { id: "u2" }, "editor", club);
    const grace = testActor({ userId: "u2", email: "u2@gmail.com", role: "editor" });
    const mine = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: club });
    const theirs = await startMove(x.deps, grace, { projectId: "p1", toSpaceId: club });
    expect(theirs.moveId).not.toBe(mine.moveId);
    await copyAll(x, "u1", mine.moveId);
    const theirCopies = await copyAll(x, "u2", theirs.moveId);
    return { x, club, mine: mine.moveId, theirs: theirs.moveId, theirCopies };
  }

  it("the first finish wins, and the other move ends with its copies gone", async () => {
    const { x, club, mine, theirs, theirCopies } = await rivals();
    const seen: unknown[] = [];
    x.deps.onDriveError = (e) => seen.push(e);
    const theirRows = await x.w.db.select().from(assets).where(eq(assets.moveId, theirs));
    expect(await finishMove(x.deps, "u1", mine)).toMatchObject({ spaceId: club });
    const [ended] = await x.w.db.select().from(projectMove).where(eq(projectMove.id, theirs));
    expect(ended.abandonedAt).not.toBeNull();
    expect(ended.finishedAt).toBeNull();
    for (const id of theirCopies.values()) expect(await x.w.db.select().from(assets).where(eq(assets.id, id))).toEqual([]);
    for (const row of theirRows) expect(x.w.fake.files.get(row.driveFileId!)?.trashed).toBe(true);
    expect(seen).toEqual([]);
    await expect(finishMove(x.deps, "u2", theirs)).rejects.toMatchObject({ code: "NOT_FOUND", message: MOVE_MESSAGES.gone });
  });

  it("finishes even when the other move's files can't be cleaned", async () => {
    const { x, club, mine, theirs, theirCopies } = await rivals();
    const seen: unknown[] = [];
    const deps: MoveDeps = { ...x.deps, driveFor: async () => { throw new Error("Drive is down"); }, onDriveError: (e) => seen.push(e) };
    expect(await finishMove(deps, "u1", mine)).toMatchObject({ spaceId: club });
    expect((await x.w.db.select().from(projectMove).where(eq(projectMove.id, theirs)))[0].abandonedAt).not.toBeNull();
    for (const id of theirCopies.values()) expect(await x.w.db.select().from(assets).where(eq(assets.id, id))).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(DriveError);
  });
});
