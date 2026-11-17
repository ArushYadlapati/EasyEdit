import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import { organization, projectMove, projects } from "@/db/schema";
import { LIMITS } from "@/lib/limits";
import { failPreview, listAssets, loadAssetFacts, openAssetFile, openUpload, removeAsset, updateAsset } from "@/lib/media/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { VIDEO, insertAsset, mediaContext, readyAsset } from "./context";

// A space with one real ready video, and two copies an unfinished move left in it: one ready, one still uploading.
async function setup() {
  const ctx = await mediaContext();
  const real = await readyAsset(ctx);
  await ctx.db.insert(organization).values({ id: "team_from", name: "From", slug: "from", createdAt: new Date(), kind: "team" });
  await ctx.db.insert(projects).values({ id: "p1", spaceId: "team_from", name: "P", format: "short_9x16", doc: { tracks: [] } as never, createdBy: ctx.ada.userId, updatedBy: ctx.ada.userId });
  const moveId = nanoid(12);
  await ctx.db.insert(projectMove).values({ id: moveId, projectId: "p1", fromSpaceId: "team_from", toSpaceId: SEED_TEAM_ID, startedBy: ctx.ada.userId });
  const same = { fileName: VIDEO.fileName, sizeBytes: VIDEO.sizeBytes, lastModifiedMs: VIDEO.lastModifiedMs, uploadedBy: ctx.ada.userId, moveId };
  const readyCopy = await insertAsset(ctx.db, { ...same, copiedFrom: "src-1" });
  const uploadingCopy = await insertAsset(ctx.db, { ...same, status: "uploading", readyAt: null, driveFileId: null, uploadUrl: "https://upload.test/copy-session", copiedFrom: "src-2" });
  return { ctx, real, readyCopy, uploadingCopy };
}

describe("copies made by an unfinished move are hidden", () => {
  it("listAssets returns neither copy", async () => {
    const { ctx, real, readyCopy, uploadingCopy } = await setup();
    expect((await listAssets(ctx.db, ctx.ada)).map((a) => a.id)).toEqual([real.id]);
    const byIds = await listAssets(ctx.db, ctx.ada, { ids: [real.id, readyCopy, uploadingCopy] });
    expect(byIds.map((a) => a.id)).toEqual([real.id]);
  });

  it("update, remove, open a file and failPreview answer NOT_FOUND", async () => {
    const { ctx, readyCopy, uploadingCopy } = await setup();
    for (const id of [readyCopy, uploadingCopy]) {
      await expect(updateAsset(ctx.db, ctx.ada, id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(removeAsset(ctx.deps, ctx.ada, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(openAssetFile(ctx.deps, ctx.ada, id, { role: "poster", sizeBytes: 1000 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(failPreview(ctx.db, ctx.ada, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("openUpload of the same file opens a new upload, not the copy's session", async () => {
    const { ctx, real, uploadingCopy } = await setup();
    // The real one is ready, so choosing the file again opens a fresh upload beside the copy.
    const opened = await openUpload(ctx.deps, ctx.ada, VIDEO);
    expect(opened.asset.id).not.toBe(uploadingCopy);
    expect(opened.asset.id).not.toBe(real.id);
    expect(opened.uploadUrl).not.toBe("https://upload.test/copy-session");
  });

  it("the unfinished-upload limit ignores copies", async () => {
    const { ctx } = await setup();
    for (let i = 0; i < LIMITS.mediaPendingPerMember; i++) {
      await insertAsset(ctx.db, { fileName: `copy-${i}.MOV`, status: "uploading", readyAt: null, driveFileId: null, uploadUrl: `https://upload.test/${i}`, uploadedBy: ctx.ada.userId, moveId: (await ctx.db.select().from(projectMove))[0].id });
    }
    const opened = await openUpload(ctx.deps, ctx.ada, { ...VIDEO, fileName: "fresh.MOV" });
    expect(opened.asset.fileName).toBe("fresh.MOV");
  });

  it("loadAssetFacts knows nothing of a copy", async () => {
    const { ctx, real, readyCopy, uploadingCopy } = await setup();
    expect((await loadAssetFacts(ctx.db, SEED_TEAM_ID, [readyCopy, uploadingCopy])).size).toBe(0);
    expect([...(await loadAssetFacts(ctx.db, SEED_TEAM_ID, [real.id, readyCopy])).keys()]).toEqual([real.id]);
  });
});
