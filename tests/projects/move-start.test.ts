import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets, projectMove, projects } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { sharedFolderClient } from "@/lib/drive/client";
import { LIMITS } from "@/lib/limits";
import { completeUpload, openUpload, type MediaDeps } from "@/lib/media/service";
import { abandonMove, moveOf, startMove, usedAssetIds, type MoveDeps } from "@/lib/projects/move";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { storageFor } from "@/lib/spaces/storage";
import { forgetAllSources } from "@/lib/storage/token-cache";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { joinSpace, testActor } from "../helpers/actor";
import { piece } from "../helpers/fake-drive";
import { storageWorld } from "../helpers/storage";
import { IMAGE, insertAsset, mediaClip } from "../media/context";

afterEach(() => vi.restoreAllMocks());

const ORIGIN = "https://app.test";

async function world() {
  const w = await storageWorld();
  const storage = { config: () => w.cfg, sharedFolder: () => sharedFolderClient(w.fake.config, { fetch: w.fake.fetch, now: w.fake.now }), fetch: w.fake.fetch };
  const deps: MoveDeps = { db: w.db, driveFor: (id) => storageFor(w.db, id, storage), origin: ORIGIN, storage };
  const setUp = async (spaceId: string, userId = "u1") => {
    const connection = await w.connect({ userId });
    await makeSetUpStorage({ config: w.cfg, fetch: w.fake.fetch })(w.db, { spaceId, connectionId: connection.id, byUserId: userId });
    return connection;
  };
  const connection = await setUp(w.personal);
  const actor = testActor();
  const track = (kind: string, clips: unknown[]) => ({ id: `t-${kind}`, kind, name: kind, muted: false, hidden: false, locked: false, clips });
  const a = await insertAsset(w.db, { name: "Clip A", previewFileId: "prev-a", posterFileId: "poster-a", driveFileId: "orig-a" });
  const b = await insertAsset(w.db, { name: "Photo B", kind: "image", driveFileId: "orig-b" });
  const doc = {
    schemaVersion: 1, format: "short_9x16", width: 1080, height: 1920, fps: 30,
    tracks: [
      track("video", [{ id: "c1", ...mediaClip(a) }, { id: "c2", ...mediaClip(a, { start: 100 }) }, { id: "c3", ...mediaClip(b, { type: "image" }) }]),
      track("text", [{ id: "c4", type: "text", start: 0, duration: 30, text: "hi", style: {}, transform: {} }]),
    ],
  };
  await w.db.insert(projects).values({ id: "p1", spaceId: actor.spaceId, name: "P", format: "short_9x16", doc: doc as never, createdBy: "u1", updatedBy: "u1" });
  return { w, deps, actor, a, b, doc: doc as never, connection, storage, setUp };
}

type World = Awaited<ReturnType<typeof world>>;

// A copy in the personal space made through the real upload path, then marked as a move's copy.
async function copyOf(x: World, moveId: string, sourceId: string, ready: boolean, file = IMAGE) {
  const drive = (await storageFor(x.w.db, x.w.personal, x.storage))!;
  const media: MediaDeps = { db: x.w.db, drive, origin: ORIGIN };
  const personal: Actor = { ...x.actor, spaceId: x.w.personal };
  const { asset, uploadUrl } = await openUpload(media, personal, { ...file, fileName: `${nanoid(4)}-${file.fileName}` });
  if (ready) {
    await piece(x.w.fake, uploadUrl, 0, file.sizeBytes, file.sizeBytes).catch(() => null);
    const sent = await completeUpload(media, personal, asset.id).catch(() => null);
    void sent;
  }
  await x.w.db.update(assets).set({ moveId, copiedFrom: sourceId }).where(eq(assets.id, asset.id));
  return asset.id;
}

const fails = (promise: Promise<unknown>, code: string, status: number, message: string) => expect(promise).rejects.toMatchObject({ code, status, message });

describe("startMove", () => {
  it("usedAssetIds lists each media asset once, in order", async () => {
    const x = await world();
    expect(usedAssetIds(x.doc)).toEqual([x.a, x.b]);
  });

  it("plans the copies of the assets the project uses", async () => {
    const x = await world();
    const plan = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
    expect(plan.projectId).toBe("p1");
    expect(plan.to).toEqual({ id: x.w.personal, name: "Personal", slug: "personal", kind: "personal" });
    expect(plan.items).toEqual([
      { sourceAssetId: x.a, kind: "video", name: "Clip A", sizeBytes: 20_000_000, originalFileId: "orig-a", previewFileId: "prev-a", posterFileId: "poster-a", copy: null },
      { sourceAssetId: x.b, kind: "image", name: "Photo B", sizeBytes: 20_000_000, originalFileId: "orig-b", previewFileId: null, posterFileId: null, copy: null },
    ]);
  });

  it("refuses the same space, a stranger's space and a viewer's seat", async () => {
    const x = await world();
    await fails(startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.actor.spaceId }), "INVALID", 400, MOVE_MESSAGES.sameSpace);
    const stranger = await x.w.team("Strangers", "u2");
    await expect(startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: stranger })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const club = await x.w.team("Club", "u2");
    await joinSpace(x.w.db, { id: "u1" }, "viewer", club);
    await fails(startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: club }), "FORBIDDEN", 403, MOVE_MESSAGES.cantEditThere("Club"));
    await expect(startMove(x.deps, { ...x.actor, role: "viewer" }, { projectId: "p1", toSpaceId: x.w.personal })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("says who can set up a destination's missing storage", async () => {
    const x = await world();
    const mine = await x.w.team("Mine");
    await fails(startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: mine }), "NO_STORAGE", 409, MOVE_MESSAGES.noStorage("Mine"));
    const theirs = await x.w.team("Theirs", "u2");
    await joinSpace(x.w.db, { id: "u1" }, "editor", theirs);
    await fails(startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: theirs }), "NO_STORAGE", 409, MOVE_MESSAGES.noStorageAskAdmin("Theirs"));
  });

  it("says when the destination's Drive needs reconnecting", async () => {
    const x = await world();
    x.w.fake.revoke(x.connection.refreshToken);
    forgetAllSources();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await fails(startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal }), "NO_STORAGE", 409, MOVE_MESSAGES.storageBroken("Personal"));
  });

  it("refuses an asset that is still uploading", async () => {
    const x = await world();
    const c = await insertAsset(x.w.db, { name: "Slow one", status: "uploading", readyAt: null, driveFileId: null, uploadUrl: "https://upload.test/s" });
    const doc = structuredClone(x.doc) as { tracks: { clips: unknown[] }[] };
    doc.tracks[0].clips.push({ id: "c9", ...mediaClip(c) });
    await x.w.db.update(projects).set({ doc: doc as never }).where(eq(projects.id, "p1"));
    await fails(startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal }), "INVALID", 400, MOVE_MESSAGES.notReady("Slow one"));
  });

  it("resumes the same move and reports the copies made so far", async () => {
    const x = await world();
    const first = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
    const copy = await copyOf(x, first.moveId, x.a, false);
    const again = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
    expect(again.moveId).toBe(first.moveId);
    expect(again.items[0].copy).toEqual({ assetId: copy, status: "uploading", hasPreview: false, hasPoster: false });
    expect(again.items[1].copy).toBeNull();
  });

  it("a move to another space abandons the earlier one and cleans its copies", async () => {
    const x = await world();
    const first = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
    const uploading = await copyOf(x, first.moveId, x.a, false);
    const ready = await copyOf(x, first.moveId, x.b, true);
    const [uRow] = await x.w.db.select().from(assets).where(eq(assets.id, uploading));
    const [rRow] = await x.w.db.select().from(assets).where(eq(assets.id, ready));
    expect(rRow.status).toBe("ready");
    const club = await x.w.team("Club");
    await x.setUp(club);
    const seen: unknown[] = [];
    x.deps.onDriveError = (e) => seen.push(e);
    const second = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: club });
    expect(second.moveId).not.toBe(first.moveId);
    const [old] = await x.w.db.select().from(projectMove).where(eq(projectMove.id, first.moveId));
    expect(old.abandonedAt).not.toBeNull();
    expect(await x.w.db.select().from(assets).where(eq(assets.moveId, first.moveId))).toEqual([]);
    expect(await x.w.db.select().from(assets).where(eq(assets.id, uploading))).toEqual([]);
    expect(await x.w.db.select().from(assets).where(eq(assets.id, ready))).toEqual([]);
    expect(seen).toEqual([]);
    const probe = await x.w.fake.fetch(uRow.uploadUrl!, { method: "PUT", headers: { "Content-Range": "bytes */3000000" } });
    expect(probe.status).toBe(499); // the session was canceled
    expect(x.w.fake.files.get(rRow.driveFileId!)?.trashed).toBe(true);
  });

  it("drops a stale move into the same space started by someone else", async () => {
    const x = await world();
    await joinSpace(x.w.db, { id: "u2" }, "editor", x.w.personal).catch(() => {});
    const stale = nanoid(12);
    await x.w.db.insert(projects).values({ id: "p2", spaceId: x.actor.spaceId, name: "Q", format: "short_9x16", doc: { tracks: [] } as never, createdBy: "u2", updatedBy: "u2" });
    await x.w.db.insert(projectMove).values({ id: stale, projectId: "p2", fromSpaceId: x.actor.spaceId, toSpaceId: x.w.personal, startedBy: "u2" });
    await copyOf(x, stale, x.a, false);
    x.w.fake.advance(LIMITS.moveAbandonAfterMs + 1000);
    await x.w.db.update(projectMove).set({ startedAt: new Date(Date.now() - LIMITS.moveAbandonAfterMs - 1000) }).where(eq(projectMove.id, stale));
    await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
    const [row] = await x.w.db.select().from(projectMove).where(eq(projectMove.id, stale));
    expect(row.abandonedAt).not.toBeNull();
    expect(await x.w.db.select().from(assets).where(eq(assets.moveId, stale))).toEqual([]);
  });
});

describe("abandonMove and moveOf", () => {
  it("only the starter may abandon, and only once", async () => {
    const x = await world();
    const plan = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
    await expect(abandonMove(x.deps, "u2", plan.moveId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(moveOf(x.w.db, "u2", plan.moveId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await moveOf(x.w.db, "u1", plan.moveId)).id).toBe(plan.moveId);
    await abandonMove(x.deps, "u1", plan.moveId);
    await expect(abandonMove(x.deps, "u1", plan.moveId)).rejects.toMatchObject({ code: "NOT_FOUND", message: MOVE_MESSAGES.gone });
    await expect(moveOf(x.w.db, "u1", plan.moveId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
