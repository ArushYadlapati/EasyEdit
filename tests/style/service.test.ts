import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { rowsOf } from "@/db";
import { assets, projects, styleReference } from "@/db/schema";
import { LIMITS } from "@/lib/limits";
import { personalSpaceId } from "@/lib/spaces/types";
import { STYLE_MESSAGES } from "@/lib/style/messages";
import {
  AGENT_SHEETS,
  CHANNEL_FACTS_DAYS,
  addChannelReference,
  addLinkReference,
  addProjectReference,
  addVideoReference,
  channelFacts,
  failVideoAnalysis,
  getStyle,
  listReferences,
  referenceSheet,
  removeReference,
  saveVideoAnalysis,
  spaceOfReference,
  styleForAgents,
  trimStaleChannelFacts,
  updateStyle,
} from "@/lib/style/service";
import { parseVideoLink, type VideoLink } from "@/lib/style/links";
import { DEFAULT_STYLE, type StyleReference, type VideoAnalysis } from "@/lib/style/types";
import { DEFAULT_TRANSFORM, createEmptyDoc, type Clip, type TimelineDoc } from "@/lib/timeline";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { insertAsset } from "../media/context";

const ada = testActor({ userId: "ada", email: "ada@gmail.com", role: "editor" });
const viewer = testActor({ userId: "vi", email: "vi@gmail.com", role: "viewer" });
const mine = testActor({ userId: "ada", email: "ada@gmail.com", role: "admin", spaceId: personalSpaceId("ada") });

const DAY = 24 * 60 * 60 * 1000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

// What a browser measures in a 12.5 s video, with a strip of three frames.
const MEASURED: VideoAnalysis = {
  kind: "video",
  seconds: 12.5,
  width: 1080,
  height: 1920,
  shots: { count: 3, averageSeconds: 4.2, medianSeconds: 4, firstSeconds: 2.5, perMinute: 14.4 },
  cuts: [2.5, 8],
  speech: { words: 30, perMinute: 144, opening: "Here's how we built it", talkingShare: 0.8 },
  sound: { loudnessDb: -16, peakDb: -1 },
  color: { brightness: 0.5, saturation: 0.4, warmth: 0.1 },
  sheet: { times: [0.2, 5, 10], columns: 3, rows: 1 },
  analyzedAt: "2026-11-25T10:00:00.000Z",
};

// A site that answers every oEmbed question with the same video's facts, and the questions it was asked.
function fakeSite(answer: Record<string, unknown> | null = { title: "Match day recap", author_name: "Seattle Solvers", thumbnail_url: "https://i.ytimg.com/vi/abc/hqdefault.jpg" }) {
  const asked: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    asked.push(String(input));
    if (answer === null) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}

const youtube = (n: number) => `https://www.youtube.com/watch?v=${String(n).padStart(11, "a")}`;

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ada" }, "editor");
  await joinSpace(db, { id: "vi" }, "viewer");
  await joinSpace(db, { id: "ada" }, "admin", personalSpaceId("ada"));
  const video = (over: Parameters<typeof insertAsset>[1] = {}) => insertAsset(db, { uploadedBy: "ada", ...over });
  const image = (over: Parameters<typeof insertAsset>[1] = {}) =>
    video({ kind: "image", name: "Logo", fileName: "logo.png", mimeType: "image/png", durationMs: null, fps: null, hasAudio: false, videoCodec: null, previewStatus: "none", ...over });
  const song = (over: Parameters<typeof insertAsset>[1] = {}) =>
    video({ kind: "audio", name: "Theme", fileName: "theme.mp3", mimeType: "audio/mpeg", width: null, height: null, fps: null, videoCodec: null, previewStatus: "none", ...over });
  return { db, video, image, song };
}

type Db = Awaited<ReturnType<typeof setup>>["db"];

// A project with two shots of a video, a song under them, and words kept for the video (which a reference never reads).
async function insertProject(db: Db, over: { id?: string; spaceId?: string; name?: string; cam: string; song: string; deletedAt?: Date }): Promise<string> {
  const clip = (id: string, type: "video" | "audio", assetId: string, start: number, duration: number) =>
    ({ id, type, assetId, start, duration, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } }) as Clip;
  const base = createEmptyDoc("short_9x16");
  const doc: TimelineDoc = {
    ...base,
    tracks: base.tracks.map((track) =>
      track.kind === "video"
        ? { ...track, clips: [clip("c1", "video", over.cam, 0, 60), clip("c2", "video", over.cam, 60, 90)] }
        : track.kind === "audio"
          ? { ...track, clips: [clip("m1", "audio", over.song, 0, 150)] }
          : track,
    ),
    captions: { transcripts: { [over.cam]: [{ t: "hi", s: 0, e: 500 }] } } as TimelineDoc["captions"],
  };
  const id = over.id ?? "p1";
  await db.insert(projects).values({
    id,
    spaceId: over.spaceId ?? ada.spaceId,
    name: over.name ?? "Match day",
    format: "short_9x16",
    doc,
    createdBy: "ada",
    updatedBy: "ada",
    deletedAt: over.deletedAt ?? null,
  });
  return id;
}

const countRows = async (db: Db) => rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from style_reference`))[0].n;

describe("a space's style", () => {
  it("is empty until someone fills it in", async () => {
    const { db } = await setup();
    expect(await getStyle(db, viewer)).toEqual(DEFAULT_STYLE);
    expect(await listReferences(db, viewer)).toEqual([]);
  });

  it("an editor's change replaces the fields named, and null or an empty value clears one", async () => {
    const { db } = await setup();
    const saved = await updateStyle(db, ada, {
      profile: { summary: "  Quick, bright recaps of match days.  ", pace: "quick", always: ["Show the score"], captions: { on: true, look: "bar" } },
      notes: "Keep the team name in every title.",
    });
    expect(saved.profile).toEqual({ summary: "Quick, bright recaps of match days.", pace: "quick", always: ["Show the score"], captions: { on: true, look: "bar" } });
    expect(saved.notes).toBe("Keep the team name in every title.");
    expect(saved.updatedBy).toBe("ada");
    expect(saved.updatedByName).toBe("ADA");
    expect(saved.updatedAt).not.toBeNull();

    const changed = await updateStyle(db, ada, { profile: { pace: null, summary: "", always: [], music: "upbeat", captions: { on: false } } });
    expect(changed.profile).toEqual({ music: "upbeat", captions: { on: false } });
    expect(changed.notes).toBe("Keep the team name in every title.");
    expect(await getStyle(db, viewer)).toEqual(changed);
  });

  it("two changes to different fields both stay", async () => {
    const { db } = await setup();
    await updateStyle(db, ada, { profile: { pace: "calm" } });
    await updateStyle(db, mine, { profile: { pace: "rapid" } }); // another space, untouched by the rest
    await updateStyle(db, ada, { profile: { look: "warm" } });
    await updateStyle(db, ada, { notes: "Hi" });
    expect((await getStyle(db, ada)).profile).toEqual({ pace: "calm", look: "warm" });
    expect((await getStyle(db, mine)).profile).toEqual({ pace: "rapid" });
  });

  it("two people changing different fields at the same moment both keep their change", async () => {
    const { db } = await setup();
    await updateStyle(db, ada, { profile: { pace: "calm", music: "soft" } });
    // Started together, as two tabs saving at once: a read-then-write save would lose one of these.
    await Promise.all([
      updateStyle(db, ada, { profile: { look: "warm", music: null } }),
      updateStyle(db, ada, { profile: { voice: "Friendly" } }),
      updateStyle(db, ada, { notes: "Hi" }),
    ]);
    expect(await getStyle(db, ada)).toMatchObject({ profile: { pace: "calm", look: "warm", voice: "Friendly" }, notes: "Hi" });
    expect((await getStyle(db, ada)).profile).not.toHaveProperty("music");
  });

  it("a change that names nothing changes nothing, not even who changed it last", async () => {
    const { db } = await setup();
    expect(await updateStyle(db, ada, {})).toEqual(DEFAULT_STYLE);
    expect(await getStyle(db, ada)).toEqual(DEFAULT_STYLE);
    const saved = await updateStyle(db, ada, { profile: { pace: "calm" } });
    const agent = { ...ada, userId: "claude:ada" };
    expect(await updateStyle(db, agent, { profile: {} })).toEqual(saved);
    // An agent's change is named as the agent, for the person it works for.
    expect(await updateStyle(db, agent, { notes: "Hi" })).toMatchObject({ updatedBy: "claude:ada", updatedByName: "Claude (for ADA)" });
  });

  it("refuses a change that doesn't check, saying which field in plain words", async () => {
    const { db } = await setup();
    const bad: { patch: Parameters<typeof updateStyle>[2]; says: string }[] = [
      { patch: { profile: { summary: "x".repeat(LIMITS.styleSummaryChars + 1) } }, says: `In a sentence or two: at most ${LIMITS.styleSummaryChars} characters.` },
      { patch: { profile: { summary: 5 as never } }, says: "In a sentence or two: should be text." },
      { patch: { profile: { pace: "slow" as never } }, says: 'Pace: use "calm", "steady", "quick" or "rapid".' },
      { patch: { profile: { lengthSeconds: { min: 50, max: 10 } } }, says: "Typical length: min can't be more than max." },
      { patch: { profile: { lengthSeconds: { min: 0, max: 10 } } }, says: "Typical length: a number from 1 to 3600." },
      { patch: { profile: { always: Array.from({ length: LIMITS.styleListItems + 1 }, (_, i) => `rule ${i}`) } }, says: `Always: at most ${LIMITS.styleListItems} items.` },
      { patch: { profile: { always: "Show the score" as never } }, says: "Always: should be a list." },
      { patch: { profile: { captions: { on: true, look: "big" as never } } }, says: 'Caption look: use "block", "karaoke", "word" or "bar".' },
      { patch: { profile: { captions: { on: "yes" as never } } }, says: "Show captions: should be true or false." },
      { patch: { profile: { captions: { on: true, size: 2 } as never } }, says: 'Captions: has no "size".' },
      { patch: { profile: { colour: "red" } as never }, says: `${STYLE_MESSAGES.notAStyleChange} A style has no "colour".` },
      { patch: { notes: "x".repeat(LIMITS.styleNotesChars + 1) }, says: STYLE_MESSAGES.notesTooLong },
      { patch: { notes: "bad \u0000 text" }, says: "Notes for AI agents" },
    ];
    for (const { patch, says } of bad) {
      const refused = updateStyle(db, ada, patch);
      await expect(refused, JSON.stringify(patch).slice(0, 60)).rejects.toMatchObject({ code: "INVALID", status: 400 });
      await expect(updateStyle(db, ada, patch)).rejects.toThrow(says);
    }
    expect(await getStyle(db, ada)).toEqual(DEFAULT_STYLE);
  });

  it("a viewer reads everything but changes nothing", async () => {
    const { db, video } = await setup();
    const asset = await video();
    const { fetchFn } = fakeSite();
    await updateStyle(db, ada, { profile: { pace: "steady" } });
    const reference = await addVideoReference(db, ada, asset);
    await expect(getStyle(db, viewer)).resolves.toMatchObject({ profile: { pace: "steady" } });
    await expect(listReferences(db, viewer)).resolves.toHaveLength(1);
    const writes = [
      updateStyle(db, viewer, { notes: "no" }),
      addVideoReference(db, viewer, asset),
      addLinkReference(db, viewer, youtube(1), fetchFn),
      addProjectReference(db, viewer, "p1"),
      addChannelReference(db, viewer, { url: youtube(2), title: "Mine" }),
      saveVideoAnalysis(db, viewer, reference.id, MEASURED, JPEG),
      failVideoAnalysis(db, viewer, reference.id, "no"),
      removeReference(db, viewer, reference.id),
    ];
    for (const write of writes) await expect(write).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("another space's references can't be seen or changed", async () => {
    const { db, video } = await setup();
    const reference = await addVideoReference(db, ada, await video());
    await saveVideoAnalysis(db, ada, reference.id, MEASURED, JPEG);
    expect(await listReferences(db, mine)).toEqual([]);
    expect(await referenceSheet(db, mine, reference.id)).toBeNull();
    for (const write of [saveVideoAnalysis(db, mine, reference.id, MEASURED, JPEG), failVideoAnalysis(db, mine, reference.id, "x"), removeReference(db, mine, reference.id)]) {
      await expect(write).rejects.toMatchObject({ code: "NOT_FOUND", status: 404, message: STYLE_MESSAGES.referenceGone });
    }
    expect(await spaceOfReference(db, reference.id)).toBe(ada.spaceId);
    expect(await spaceOfReference(db, "never-existed")).toBeNull();
  });
});

describe("learning from the space's videos", () => {
  it("adds a finished video as pending, named after it", async () => {
    const { db, video } = await setup();
    const asset = await video({ name: "Match day recap" });
    const reference = await addVideoReference(db, ada, asset);
    expect(reference).toMatchObject({ kind: "video", title: "Match day recap", status: "pending", assetId: asset, analysis: null, hasSheet: false });
    expect(await listReferences(db, viewer)).toEqual([reference]);
    await expect(addVideoReference(db, ada, asset)).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.alreadyAdded });
  });

  it("refuses a picture, an unfinished upload, a removed video and another space's", async () => {
    const { db, video, image } = await setup();
    await expect(addVideoReference(db, ada, await image())).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.notAVideo });
    await expect(addVideoReference(db, ada, await video({ status: "uploading", readyAt: null }))).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.notReady });
    await expect(addVideoReference(db, ada, await video({ removedAt: new Date(), removedBy: "ada" }))).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(addVideoReference(db, ada, await video({ spaceId: personalSpaceId("ada") }))).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(addVideoReference(db, ada, "never-existed")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await countRows(db)).toBe(0);
  });

  it("saves what a browser measured and the strip of frames, which any member can fetch", async () => {
    const { db, video } = await setup();
    const reference = await addVideoReference(db, ada, await video());
    const saved = await saveVideoAnalysis(db, ada, reference.id, MEASURED, JPEG);
    expect(saved).toMatchObject({ status: "ready", analysis: MEASURED, hasSheet: true });
    expect(saved.failure).toBeUndefined();
    expect(await referenceSheet(db, viewer, reference.id)).toEqual(JPEG);
    expect((await listReferences(db, viewer))[0]).toEqual(saved);

    // Measured again with no strip: the old strip goes, and so does the plan of its frames.
    const again = await saveVideoAnalysis(db, ada, reference.id, { ...MEASURED, seconds: 13 }, null);
    expect(again).toMatchObject({ hasSheet: false, analysis: { seconds: 13, sheet: null } });
    expect(await referenceSheet(db, viewer, reference.id)).toBeNull();
  });

  it("refuses measurements that don't check, a strip too big or not a JPEG, and a strip with no plan", async () => {
    const { db, video } = await setup();
    const reference = await addVideoReference(db, ada, await video());
    const tooBig = new Uint8Array(LIMITS.styleSheetBytes + 1);
    tooBig.set(JPEG);
    const refused: [unknown, Uint8Array | null, string][] = [
      [{ ...MEASURED, seconds: -1 }, null, STYLE_MESSAGES.badAnalysis],
      [{ ...MEASURED, cuts: [8, 2.5] }, null, STYLE_MESSAGES.badAnalysis],
      [{ ...MEASURED, extra: true }, null, STYLE_MESSAGES.badAnalysis],
      [{ ...MEASURED, kind: "link" }, null, STYLE_MESSAGES.badAnalysis],
      ["not facts", null, STYLE_MESSAGES.badAnalysis],
      [MEASURED, tooBig, STYLE_MESSAGES.sheetTooBig],
      [MEASURED, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), STYLE_MESSAGES.badAnalysis],
      [{ ...MEASURED, sheet: null }, JPEG, STYLE_MESSAGES.badAnalysis],
    ];
    for (const [analysis, sheet, message] of refused) {
      await expect(saveVideoAnalysis(db, ada, reference.id, analysis, sheet), JSON.stringify(analysis).slice(0, 60)).rejects.toMatchObject({ code: "INVALID", message });
    }
    expect((await listReferences(db, ada))[0]).toMatchObject({ status: "pending", analysis: null });
  });

  it("a video that couldn't be measured is failed with the reason, and can be measured again", async () => {
    const { db, video } = await setup();
    const reference = await addVideoReference(db, ada, await video());
    const failed = await failVideoAnalysis(db, ada, reference.id, "  This video's\nsound couldn't be read.  ");
    expect(failed).toMatchObject({ status: "failed", failure: "This video's sound couldn't be read.", analysis: null });
    expect(await failVideoAnalysis(db, ada, reference.id, "\u0000")).not.toHaveProperty("failure");
    const ready = await saveVideoAnalysis(db, ada, reference.id, MEASURED, JPEG);
    expect(ready).toMatchObject({ status: "ready" });
    expect(ready.failure).toBeUndefined();
    // Another tab giving up later doesn't undo what was measured.
    expect(await failVideoAnalysis(db, ada, reference.id, "Gave up")).toEqual(ready);
  });

  it("only a video reference takes measurements", async () => {
    const { db } = await setup();
    const link = await addLinkReference(db, ada, youtube(1), fakeSite().fetchFn);
    await expect(saveVideoAnalysis(db, ada, link.id, MEASURED, JPEG)).rejects.toMatchObject({ code: "INVALID" });
    await expect(failVideoAnalysis(db, ada, link.id, "x")).rejects.toMatchObject({ code: "INVALID" });
    await expect(saveVideoAnalysis(db, ada, "never-existed", MEASURED, JPEG)).rejects.toMatchObject({ code: "NOT_FOUND", message: STYLE_MESSAGES.referenceGone });
  });
});

describe("learning from links", () => {
  it("keeps a link's public facts, at its one address", async () => {
    const { db } = await setup();
    const { fetchFn, asked } = fakeSite();
    const reference = await addLinkReference(db, ada, "youtu.be/abcdefghijk?t=30", fetchFn);
    expect(reference).toMatchObject({
      kind: "link",
      status: "ready",
      title: "Match day recap",
      author: "Seattle Solvers",
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      analysis: { kind: "link", provider: "youtube", title: "Match day recap" },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0].startsWith("https://www.youtube.com/oembed?")).toBe(true);
  });

  it("keeps a link its site says nothing about, with the address as its title", async () => {
    const { db } = await setup();
    const reference = await addLinkReference(db, ada, "https://vimeo.com/76979871", fakeSite(null).fetchFn);
    expect(reference).toMatchObject({ title: "https://vimeo.com/76979871", provider: "vimeo", analysis: { unreadable: true } });
    expect(reference.author).toBeUndefined();
  });

  it("refuses Instagram, TikTok share links and other sites without asking anyone", async () => {
    const { db } = await setup();
    const { fetchFn } = fakeSite();
    const refused: [string, string][] = [
      ["https://www.instagram.com/reel/Cx1abc/", STYLE_MESSAGES.instagram],
      ["https://vm.tiktok.com/ZMabc/", STYLE_MESSAGES.tiktokShareLink],
      ["https://example.com/video.mp4", STYLE_MESSAGES.badLink],
      ["not a link at all", STYLE_MESSAGES.badLink],
    ];
    for (const [url, message] of refused) await expect(addLinkReference(db, ada, url, fetchFn)).rejects.toMatchObject({ code: "INVALID", status: 400, message });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses the same video twice, however the link is written", async () => {
    const { db } = await setup();
    const { fetchFn } = fakeSite();
    await addLinkReference(db, ada, "https://www.youtube.com/watch?v=abcdefghijk", fetchFn);
    await expect(addLinkReference(db, ada, "https://youtu.be/abcdefghijk", fetchFn)).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.alreadyAdded });
    // The same video as a Short, and a Short as its watch page.
    await expect(addLinkReference(db, ada, "https://youtube.com/shorts/abcdefghijk", fetchFn)).rejects.toMatchObject({ message: STYLE_MESSAGES.alreadyAdded });
    await addLinkReference(db, ada, "https://youtube.com/shorts/bcdefghijkl", fetchFn);
    await expect(addLinkReference(db, ada, "https://www.youtube.com/watch?v=bcdefghijkl", fetchFn)).rejects.toMatchObject({ message: STYLE_MESSAGES.alreadyAdded });
    await expect(addChannelReference(db, ada, { url: "https://www.youtube.com/watch?v=bcdefghijkl", title: "x" })).rejects.toMatchObject({ message: STYLE_MESSAGES.alreadyAdded });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Another space may have it too.
    await expect(addLinkReference(db, mine, "https://youtu.be/abcdefghijk", fetchFn)).resolves.toMatchObject({ kind: "link" });
  });

  it(`learns from at most ${LIMITS.styleReferences} things`, async () => {
    const { db, video } = await setup();
    const { fetchFn } = fakeSite();
    for (let i = 0; i < LIMITS.styleReferences; i++) await addLinkReference(db, ada, youtube(i), fetchFn);
    await expect(addLinkReference(db, ada, youtube(99), fetchFn)).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.tooManyReferences });
    await expect(addVideoReference(db, ada, await video())).rejects.toMatchObject({ message: STYLE_MESSAGES.tooManyReferences });
    expect(fetchFn).toHaveBeenCalledTimes(LIMITS.styleReferences);
    // Removing one makes room.
    const [newest] = await listReferences(db, ada);
    await removeReference(db, ada, newest.id);
    await expect(addLinkReference(db, ada, youtube(99), fetchFn)).resolves.toMatchObject({ kind: "link" });
  });
});

describe("learning from past projects", () => {
  it("counts the project now, without its transcripts", async () => {
    const { db, video, song } = await setup();
    const id = await insertProject(db, { cam: await video(), song: await song(), name: "Match day" });
    const reference = await addProjectReference(db, ada, id);
    expect(reference).toMatchObject({ kind: "project", status: "ready", title: "Match day", projectId: id });
    expect(reference.analysis).toMatchObject({ kind: "project", format: "short_9x16", fps: 30, seconds: 5, shots: { count: 2 }, music: { clips: 1, averageVolume: 1 } });
    await expect(addProjectReference(db, ada, id)).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.alreadyAdded });
  });

  it("refuses a deleted project and another space's", async () => {
    const { db, video, song } = await setup();
    const cam = await video();
    const tune = await song();
    await insertProject(db, { id: "gone", cam, song: tune, deletedAt: new Date() });
    await insertProject(db, { id: "theirs", cam, song: tune, spaceId: personalSpaceId("ada") });
    for (const id of ["gone", "theirs", "never-existed"]) {
      await expect(addProjectReference(db, ada, id)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404, message: STYLE_MESSAGES.projectGone });
    }
  });
});

describe("removing, and what goes with a video or project", () => {
  it("an editor removes a reference", async () => {
    const { db, video } = await setup();
    const reference = await addVideoReference(db, ada, await video());
    await removeReference(db, ada, reference.id);
    expect(await listReferences(db, ada)).toEqual([]);
    await expect(removeReference(db, ada, reference.id)).rejects.toMatchObject({ code: "NOT_FOUND", message: STYLE_MESSAGES.referenceGone });
  });

  it("a video removed from the library, or a deleted project, drops out", async () => {
    const { db, video, song } = await setup();
    const cam = await video();
    const shown = await addVideoReference(db, ada, cam);
    await saveVideoAnalysis(db, ada, shown.id, MEASURED, JPEG);
    const project = await addProjectReference(db, ada, await insertProject(db, { cam: await video(), song: await song() }));
    await db.update(assets).set({ removedAt: new Date(), removedBy: "ada" }).where(eq(assets.id, cam));
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.projectId!));
    expect(await listReferences(db, ada)).toEqual([]);
    expect(await referenceSheet(db, ada, shown.id)).toBeNull();
    expect((await styleForAgents(db, ada.spaceId)).sheets).toEqual([]);
    expect(await countRows(db)).toBe(2);
    // Neither comes back, so the next one added clears them out, strip of frames and all.
    await addLinkReference(db, ada, youtube(1), fakeSite().fetchFn);
    expect(await countRows(db)).toBe(1);
  });

  it("a project moved to another space is hidden, and is back when it is moved back", async () => {
    const { db, video, song } = await setup();
    const project = await addProjectReference(db, ada, await insertProject(db, { cam: await video(), song: await song() }));
    await db.update(projects).set({ spaceId: mine.spaceId }).where(eq(projects.id, project.projectId!));
    expect(await listReferences(db, ada)).toEqual([]);
    await addLinkReference(db, ada, youtube(1), fakeSite().fetchFn); // doesn't clear it out
    await db.update(projects).set({ spaceId: ada.spaceId }).where(eq(projects.id, project.projectId!));
    expect((await listReferences(db, ada)).map((r) => r.id)).toContain(project.id);
  });

  it("the row goes when its video or project does", async () => {
    const { db, video, song } = await setup();
    const cam = await video();
    await addVideoReference(db, ada, cam);
    const project = await addProjectReference(db, ada, await insertProject(db, { cam: await video(), song: await song() }));
    expect(await countRows(db)).toBe(2);
    await db.delete(projects).where(eq(projects.id, project.projectId!));
    expect(await countRows(db)).toBe(1);
    await db.delete(assets).where(eq(assets.id, cam));
    expect(await countRows(db)).toBe(0);
  });
});

describe("the connected channel's uploads", () => {
  const upload = { url: "https://www.youtube.com/shorts/abcdefghijk", title: "  Match\nday  ", author: "Seattle Solvers", thumbnailUrl: "https://i.ytimg.com/vi/x/default.jpg", seconds: 41.234, description: "Our day.", tags: ["robots", "robots", "  "] };

  it("keeps YouTube's facts, cut to fit", () => {
    const link = parseVideoLink(upload.url) as VideoLink;
    const now = new Date("2026-11-25T10:00:00.000Z");
    expect(channelFacts(link, upload, now)).toEqual({
      kind: "link",
      provider: "channel",
      title: "Match day",
      author: "Seattle Solvers",
      thumbnailUrl: "https://i.ytimg.com/vi/x/default.jpg",
      seconds: 41.23,
      description: "Our day.",
      tags: ["robots"],
      short: true,
      fetchedAt: now.toISOString(),
    });
    const odd = channelFacts(link, { ...upload, title: "", thumbnailUrl: "https://evil.example/x.jpg", seconds: -3, tags: Array.from({ length: 40 }, (_, i) => `t${i}`) }, now);
    expect(odd.title).toBe(link.url);
    expect(odd.thumbnailUrl).toBeUndefined();
    expect(odd.seconds).toBeUndefined();
    expect(odd.tags).toHaveLength(15);
  });

  it("adds one, refreshes it when added again, and refuses one already pasted as a link", async () => {
    const { db } = await setup();
    const added = await addChannelReference(db, ada, upload, new Date(Date.now() - DAY));
    expect(added).toMatchObject({ kind: "link", provider: "channel", title: "Match day", url: upload.url, author: "Seattle Solvers" });
    const refreshed = await addChannelReference(db, ada, { ...upload, title: "Match day, again" });
    expect(refreshed).toMatchObject({ id: added.id, title: "Match day, again" });
    expect(await listReferences(db, ada)).toHaveLength(1);

    await addLinkReference(db, ada, youtube(7), fakeSite().fetchFn);
    await expect(addChannelReference(db, ada, { url: youtube(7), title: "x" })).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.alreadyAdded });
    await expect(addChannelReference(db, ada, { url: "https://vimeo.com/76979871", title: "x" })).rejects.toMatchObject({ code: "INVALID", message: STYLE_MESSAGES.badLink });
  });

  it(`after ${CHANNEL_FACTS_DAYS} days, only the title and link are kept`, async () => {
    const { db } = await setup();
    const added = await addChannelReference(db, ada, upload);
    expect(await listReferences(db, ada, new Date(Date.now() + (CHANNEL_FACTS_DAYS - 1) * DAY))).toEqual([added]);

    const later = new Date(Date.now() + (CHANNEL_FACTS_DAYS + 1) * DAY);
    const [trimmed] = await listReferences(db, ada, later);
    expect(trimmed).toEqual({
      id: added.id,
      kind: "link",
      title: "Match day",
      status: "ready",
      provider: "channel",
      url: upload.url,
      analysis: { kind: "link", provider: "channel", title: "Match day", fetchedAt: (added.analysis as { fetchedAt: string }).fetchedAt },
      hasSheet: false,
      createdAt: added.createdAt,
    });
    // Dropped for good, not only hidden.
    const [row] = await db.select().from(styleReference).where(eq(styleReference.id, added.id));
    expect(row).toMatchObject({ author: null, thumbnailUrl: null, analysis: trimmed.analysis });
    expect(await listReferences(db, ada)).toEqual([trimmed]);
    // Refreshing brings the facts back.
    expect(await addChannelReference(db, ada, upload)).toMatchObject({ author: "Seattle Solvers", analysis: { tags: ["robots"] } });
  });

  it("the trim leaves other references alone", () => {
    const now = new Date("2026-11-25T10:00:00.000Z");
    const link: StyleReference = {
      id: "r1",
      kind: "link",
      title: "Old",
      status: "ready",
      provider: "youtube",
      author: "A",
      url: youtube(1),
      analysis: { kind: "link", provider: "youtube", title: "Old", author: "A", fetchedAt: "2020-01-01T00:00:00.000Z" },
      hasSheet: false,
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    expect(trimStaleChannelFacts(link, now)).toBe(link);
    const unknownAge: StyleReference = { ...link, provider: "channel", analysis: null };
    // A channel reference whose age can't be told counts as old.
    expect(trimStaleChannelFacts(unknownAge, now)).toEqual({ id: "r1", kind: "link", title: "Old", status: "ready", provider: "channel", url: youtube(1), analysis: null, hasSheet: false, createdAt: link.createdAt });
    const fresh: StyleReference = { ...link, provider: "channel", analysis: { ...link.analysis!, provider: "channel", fetchedAt: "2026-11-20T00:00:00.000Z" } as StyleReference["analysis"] };
    expect(trimStaleChannelFacts(fresh, now)).toBe(fresh);
  });
});

describe("what agents read", () => {
  it("the style, every reference, and the newest measured videos' strips", async () => {
    const { db, video } = await setup();
    await updateStyle(db, ada, { profile: { pace: "quick" }, notes: "Short and bright." });
    const ids: string[] = [];
    for (let i = 0; i < AGENT_SHEETS + 1; i++) {
      const reference = await addVideoReference(db, ada, await video({ name: `Clip ${i}` }));
      await saveVideoAnalysis(db, ada, reference.id, MEASURED, JPEG);
      await db.update(styleReference).set({ createdAt: new Date(Date.UTC(2026, 10, 1 + i)) }).where(eq(styleReference.id, reference.id));
      ids.push(reference.id);
    }
    const pending = await addVideoReference(db, ada, await video({ name: "Not yet" }));
    await addLinkReference(db, ada, youtube(3), fakeSite().fetchFn);

    const read = await styleForAgents(db, ada.spaceId);
    expect(read).toMatchObject({ profile: { pace: "quick" }, notes: "Short and bright.", updatedBy: "ada" });
    expect(read.references).toHaveLength(AGENT_SHEETS + 3);
    expect(read.references.map((r) => r.id)).toContain(pending.id);
    expect(read.sheets.map((s) => s.referenceId)).toEqual(ids.slice(1).reverse());
    expect(read.sheets[0]).toEqual({ referenceId: ids[AGENT_SHEETS], title: `Clip ${AGENT_SHEETS}`, jpeg: JPEG, plan: MEASURED.sheet });
    expect(await styleForAgents(db, mine.spaceId)).toEqual({ ...DEFAULT_STYLE, references: [], sheets: [] });
  });
});
