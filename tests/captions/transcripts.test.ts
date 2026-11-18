import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assetTranscripts, assets } from "@/db/schema";
import { getTranscript, loadTranscripts, saveTranscript } from "@/lib/captions/transcripts";
import { LIMITS } from "@/lib/limits";
import { openUpload } from "@/lib/media/service";
import { personalSpaceId } from "@/lib/spaces/types";
import { AUDIO, IMAGE, insertAsset, mediaContext, readyAsset, teamWithStorage } from "../media/context";

const WORDS = [
  { t: "hello", s: 0, e: 400 },
  { t: "world", s: 500, e: 900 },
];
const saved = { words: WORDS, model: "whisper-small" };

describe("saved transcripts", () => {
  it("saves words and reads them back, and a file with none gives null", async () => {
    const ctx = await mediaContext();
    const video = await readyAsset(ctx);
    expect(await getTranscript(ctx.db, ctx.ada, video.id)).toBeNull();
    await saveTranscript(ctx.db, ctx.ada, video.id, saved);
    expect(await getTranscript(ctx.db, ctx.ada, video.id)).toEqual(saved);
    expect(await getTranscript(ctx.db, ctx.vera, video.id)).toEqual(saved); // a viewer may read
    await saveTranscript(ctx.db, ctx.ada, (await readyAsset(ctx, ctx.ada, AUDIO)).id, { words: [], model: "m" }); // audio, and no words
  });

  it("replaces the words and moves updatedAt, and keeps the first saver", async () => {
    const ctx = await mediaContext();
    const video = await readyAsset(ctx);
    await saveTranscript(ctx.db, ctx.ada, video.id, saved);
    const [first] = await ctx.db.select().from(assetTranscripts).where(eq(assetTranscripts.assetId, video.id));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveTranscript(ctx.db, ctx.grace, video.id, { words: [{ t: "again", s: 0, e: 10 }], model: "whisper-base" });
    const rows = await ctx.db.select().from(assetTranscripts).where(eq(assetTranscripts.assetId, video.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ words: [{ t: "again", s: 0, e: 10 }], model: "whisper-base", createdBy: "user-ada", spaceId: first.spaceId });
    expect(rows[0].updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(rows[0].createdAt).toEqual(first.createdAt);
  });

  it("lets a viewer read but not save", async () => {
    const ctx = await mediaContext();
    const video = await readyAsset(ctx);
    await expect(saveTranscript(ctx.db, ctx.vera, video.id, saved)).rejects.toMatchObject({ status: 403 });
    expect(await getTranscript(ctx.db, ctx.vera, video.id)).toBeNull();
  });

  it("answers 404 to someone in another space, for both", async () => {
    const ctx = await mediaContext();
    const video = await readyAsset(ctx);
    await saveTranscript(ctx.db, ctx.ada, video.id, saved);
    const stranger = { ...ctx.grace, spaceId: personalSpaceId(ctx.grace.userId) };
    await expect(getTranscript(ctx.db, stranger, video.id)).rejects.toMatchObject({ status: 404 });
    await expect(saveTranscript(ctx.db, stranger, video.id, saved)).rejects.toMatchObject({ status: 404 });
    await expect(getTranscript(ctx.db, ctx.ada, "nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an image, an unfinished upload and a removed file", async () => {
    const ctx = await mediaContext();
    const image = await readyAsset(ctx, ctx.ada, IMAGE);
    await expect(saveTranscript(ctx.db, ctx.ada, image.id, saved)).rejects.toMatchObject({ status: 400, code: "INVALID" });

    const { asset: unfinished } = await openUpload(ctx.deps, ctx.ada, AUDIO);
    await expect(saveTranscript(ctx.db, ctx.ada, unfinished.id, saved)).rejects.toMatchObject({ status: 400, code: "INVALID" });

    const video = await readyAsset(ctx);
    await ctx.db.update(assets).set({ removedAt: new Date() }).where(eq(assets.id, video.id));
    await expect(saveTranscript(ctx.db, ctx.ada, video.id, saved)).rejects.toMatchObject({ status: 404 });
    await expect(getTranscript(ctx.db, ctx.ada, video.id)).rejects.toMatchObject({ status: 404 });
    expect(await ctx.db.select().from(assetTranscripts)).toEqual([]);
  });

  it("refuses words out of order, too many, a long word, and a bad model", async () => {
    const ctx = await mediaContext();
    const video = await readyAsset(ctx);
    const refused = (input: { words: unknown; model: string }) =>
      expect(saveTranscript(ctx.db, ctx.ada, video.id, input as never)).rejects.toMatchObject({ status: 400, code: "INVALID" });
    await refused({ words: [{ t: "b", s: 500, e: 600 }, { t: "a", s: 0, e: 100 }], model: "m" });
    await refused({ words: Array.from({ length: LIMITS.captionWordsPerFile + 1 }, (_, i) => ({ t: "w", s: i, e: i + 1 })), model: "m" });
    await refused({ words: [{ t: "x".repeat(LIMITS.captionWordChars + 1), s: 0, e: 1 }], model: "m" });
    await refused({ words: "no", model: "m" });
    await refused({ words: WORDS, model: "" });
    await refused({ words: WORDS, model: "x".repeat(101) });
    await saveTranscript(ctx.db, ctx.ada, video.id, { words: WORDS, model: "x".repeat(100) });
    expect(await ctx.db.select().from(assetTranscripts)).toHaveLength(1); // only the good one
  });

  it("goes when its file's row is deleted", async () => {
    const ctx = await mediaContext();
    const video = await readyAsset(ctx);
    await saveTranscript(ctx.db, ctx.ada, video.id, saved);
    await ctx.db.delete(assets).where(eq(assets.id, video.id));
    expect(await ctx.db.select().from(assetTranscripts)).toEqual([]);
  });

  it("loadTranscripts gives only the space's own files", async () => {
    const ctx = await mediaContext();
    const mine = await readyAsset(ctx);
    const without = await readyAsset(ctx, ctx.ada, AUDIO);
    await saveTranscript(ctx.db, ctx.ada, mine.id, saved);
    const team = await teamWithStorage(ctx, "Other Team");
    const theirs = await insertAsset(ctx.db, { spaceId: team.spaceId });
    await saveTranscript(ctx.db, team.as(ctx.ada), theirs, { words: [{ t: "x", s: 0, e: 1 }], model: "m" });

    const seattle = await loadTranscripts(ctx.db, ctx.ada.spaceId, [mine.id, without.id, theirs, mine.id]);
    expect([...seattle.keys()]).toEqual([mine.id]);
    expect(seattle.get(mine.id)).toEqual(WORDS);
    expect([...(await loadTranscripts(ctx.db, team.spaceId, [mine.id, theirs])).keys()]).toEqual([theirs]);
    expect((await loadTranscripts(ctx.db, ctx.ada.spaceId, [])).size).toBe(0);
  });
});
