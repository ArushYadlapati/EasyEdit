import { describe, expect, it } from "vitest";
import { nestSelection, unnestSelection } from "@/lib/editor/actions";
import { mediaWants, upcomingAssetIds } from "@/lib/editor/media-plan";
import { nestOps, unnestOps } from "@/lib/editor/nest";
import { MESSAGES } from "@/lib/editor/messages";
import { probeRequests } from "@/lib/export/fonts";
import { mediaSchedule } from "@/lib/export/media-schedule";
import { exportAssetIds } from "@/lib/export/media-sources";
import { assetIdsToCheck, findMediaProblem } from "@/lib/media/refs";
import { usedAssetIds } from "@/lib/projects/move";
import { soundingClips } from "@/lib/render/clip-sound";
import { needsFinisher } from "@/lib/render/grade";
import { applyOps, prepareOps, type MediaClip, type NestClip, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, text, video } from "./fixtures";

// v1 [c1 0–30, c2 30–60, c3 90–120] · t1 [x1 10–50] · cap · a1 [m1 0–60 of "song"]
function doc(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { in: 100 }), video("c3", 90, 30)];
  d.tracks[1].clips = [text("x1", 10, 40, { text: "Intro" })];
  d.tracks[3].clips = [video("m1", 0, 60, { type: "audio", assetId: "song" })];
  change(d);
  return d;
}
const ids = () => {
  let n = 0;
  return () => `g${++n}`;
};
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const nestOf = (d: TimelineDoc) => d.tracks.flatMap((t) => t.clips).find((c) => c.type === "nest") as NestClip;
const rows = (d: TimelineDoc) => Object.fromEntries(d.tracks.map((t) => [t.id, t.clips.map((c) => `${c.id}:${c.start}-${c.start + c.duration}`)]));

describe("nesting clips", () => {
  it("makes them one clip that takes their place in time, on the video track they left", () => {
    const nesting = nestOps(doc(), ["c2", "x1", "m1", "c1"], ids());
    if (!nesting.ok) throw new Error(nesting.why);
    const after = run(doc(), nesting.ops).doc;
    const nest = nestOf(after);
    expect([nest.id, nest.start, nest.duration, nest.in, nest.volume]).toEqual([nesting.clipId, 0, 60, 0, 1]);
    expect(rows(after)).toMatchObject({ v1: [`${nest.id}:0-60`, "c3:90-120"], t1: [], a1: [] });
    // Inside, each clip is on a track like the one it was on, as far from the start as it was.
    expect(nest.tracks.map((t) => [t.id, t.kind, t.clips.map((c) => `${c.id}:${c.start}`)])).toEqual([
      ["v1", "video", ["c1:0", "c2:30"]],
      ["t1", "text", ["x1:10"]],
      ["a1", "audio", ["m1:0"]],
    ]);
    expect((nest.tracks[0].clips[1] as MediaClip).in).toBe(100);
    expect(applyOps(after, run(doc(), nesting.ops).inverse).doc).toEqual(doc());
  });
  it("starts the nest at its first clip, wherever that is, and keeps the gaps between its clips", () => {
    const nesting = nestOps(doc(), ["c2", "c3"], ids());
    if (!nesting.ok) throw new Error(nesting.why);
    const nest = nestOf(run(doc(), nesting.ops).doc);
    expect([nest.start, nest.duration, nest.tracks[0].clips.map((c) => c.start)]).toEqual([30, 90, [0, 60]]);
  });
  it("goes on a new overlay track when the clips' own video track is taken there, or they had none", () => {
    // Only the title and the song: there is a video under them the whole way.
    const nesting = nestOps(doc(), ["x1", "m1"], ids());
    if (!nesting.ok) throw new Error(nesting.why);
    const after = run(doc(), nesting.ops).doc;
    const home = after.tracks.find((t) => t.clips.some((c) => c.type === "nest"))!;
    expect([home.kind, home.name, rows(after).v1]).toEqual(["overlay", "Overlay 1", ["c1:0-30", "c2:30-60", "c3:90-120"]]);
  });
  it("takes one clip too, and refuses nothing, a slot, a nest, or a clip on a locked track", () => {
    expect(nestOps(doc(), ["c1"], ids()).ok).toBe(true);
    expect(nestOps(doc(), [], ids())).toEqual({ ok: false, why: "nothing" });
    expect(nestOps(doc(), ["gone"], ids())).toEqual({ ok: false, why: "nothing" });
    expect(nestOps(doc((d) => void (d.tracks[0].locked = true)), ["c1", "x1"], ids())).toEqual({ ok: false, why: "locked" });
    const slot = doc((d) => void d.tracks[0].clips.push({ id: "s1", type: "placeholder", accepts: "visual", start: 200, duration: 30, transform: d.tracks[0].clips[0].transform, slot: { name: "Clip", kind: "video" } } as never));
    expect(nestOps(slot, ["c1", "s1"], ids())).toEqual({ ok: false, why: "slot" });
    const first = nestOps(doc(), ["c1", "c2"], ids());
    if (!first.ok) throw new Error(first.why);
    expect(nestOps(run(doc(), first.ops).doc, [first.clipId, "c3"], ids())).toEqual({ ok: false, why: "nest" });
  });
});

describe("taking a nest apart", () => {
  const nested = (picked = ["c1", "c2", "x1", "m1"]) => {
    const nesting = nestOps(doc(), picked, ids());
    if (!nesting.ok) throw new Error(nesting.why);
    return { doc: run(doc(), nesting.ops).doc, id: nesting.clipId };
  };
  it("puts its clips back where they were, on the tracks they came from", () => {
    const made = nested();
    const apart = unnestOps(made.doc, made.id, ids());
    if (!apart.ok) throw new Error(apart.why);
    const after = run(made.doc, apart.ops).doc;
    expect(Object.values(rows(after)).map((r) => r.map((c) => c.split(":")[1]))).toEqual([["0-30", "30-60", "90-120"], ["10-50"], [], ["0-60"]]);
    expect(after.tracks.map((t) => t.kind)).toEqual(doc().tracks.map((t) => t.kind)); // no track was made
    expect(apart.clipIds).toHaveLength(4);
    expect(after.tracks.flatMap((t) => t.clips).some((c) => c.type === "nest")).toBe(false);
    expect((after.tracks[0].clips[1] as MediaClip).in).toBe(100);
    expect(applyOps(after, run(made.doc, apart.ops).inverse).doc).toEqual(made.doc);
  });
  it("gives back only the part the nest plays, where it plays it", () => {
    const made = nested();
    // Moved to frame 200 and trimmed to frames 20 to 45 of what it holds.
    const moved = run(made.doc, [{ op: "trim_clip", clipId: made.id, edge: "start", to: 20 }, { op: "trim_clip", clipId: made.id, edge: "end", to: 45 }, { op: "move_clip", clipId: made.id, start: 200 }]).doc;
    const apart = unnestOps(moved, made.id, ids());
    if (!apart.ok) throw new Error(apart.why);
    const after = run(moved, apart.ops).doc;
    const back = after.tracks.flatMap((t) => t.clips).filter((c) => c.start >= 200).map((c) => [c.type, c.start, c.duration, (c as MediaClip).in]);
    expect(back).toEqual([["video", 200, 10, 20], ["video", 210, 15, 100], ["text", 200, 25, undefined], ["audio", 200, 25, 20]]);
  });
  it("finds another track, or makes one, when the one a clip came from is taken or gone", () => {
    const made = nested(["x1"]);
    const taken = run(made.doc, [{ op: "add_clip", trackId: "t1", clip: text("x9", 0, 60) as never }]).doc;
    let n = 100; // ids of its own: the nest's track took the first ones
    const apart = unnestOps(taken, made.id, () => `u${++n}`);
    if (!apart.ok) throw new Error(apart.why);
    const after = run(taken, apart.ops).doc;
    const texts = after.tracks.filter((t) => t.kind === "text");
    expect(texts.map((t) => t.clips.map((c) => `${c.start}-${c.start + c.duration}`))).toEqual([["0-60"], ["10-50"]]);
  });
  it("is refused for what is not a nest, and on a locked track", () => {
    const made = nested();
    expect(unnestOps(made.doc, "c3", ids())).toEqual({ ok: false, why: "not-a-nest" });
    expect(unnestOps(made.doc, "gone", ids())).toEqual({ ok: false, why: "not-a-nest" });
    made.doc.tracks[0].locked = true;
    expect(unnestOps(made.doc, made.id, ids())).toEqual({ ok: false, why: "locked" });
  });
});

describe("from the editor", () => {
  it("nests the selection as one change and selects the nest; unnests it and selects what comes out", () => {
    const store = makeStore({ doc: doc() });
    store.getState().select(["c1", "c2", "x1"]);
    nestSelection(store);
    const nest = nestOf(store.getState().doc);
    expect([store.getState().selection.clipIds, store.getState().queue.at(-1)?.label]).toEqual([[nest.id], "nest clips"]);
    unnestSelection(store);
    expect(store.getState().queue.at(-1)?.label).toBe("unnest");
    expect(store.getState().selection.clipIds).toHaveLength(3);
    expect(nestOf(store.getState().doc)).toBeUndefined();
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc());
  });
  it("says why when it cannot", () => {
    const store = makeStore({ doc: doc() });
    const notices = noticesOf(store);
    nestSelection(store);
    store.getState().select(["c1"]);
    unnestSelection(store);
    store.getState().select(["c1", "c2"]);
    unnestSelection(store);
    expect(notices).toEqual([MESSAGES.nestRefused.nothing, MESSAGES.unnestRefused["not-a-nest"], MESSAGES.unnestRefused["not-a-nest"]]);
    const viewer = makeStore({ doc: doc(), canEdit: false });
    viewer.getState().select(["c1"]);
    nestSelection(viewer);
    expect(viewer.getState().doc).toEqual(doc());
  });
});

describe("what reads a project finds a nest's clips", () => {
  // c1 and c2 (asset "a") and the song nested; the nest then moved to start at frame 300.
  const made = () => {
    const nesting = nestOps(doc(), ["c1", "c2", "x1", "m1"], ids());
    if (!nesting.ok) throw new Error(nesting.why);
    const moved = run(doc(), [...nesting.ops, { op: "move_clip", clipId: nesting.clipId, start: 300 }, { op: "update_clip", clipId: nesting.clipId, patch: { volume: 0.5 } }]).doc;
    return { doc: moved, id: nesting.clipId };
  };
  it("the preview plays them where the nest plays them, under the nest's name, as loud as the nest makes them", () => {
    const { doc: d, id } = made();
    const wants = mediaWants(d, 340, { playing: true, rate: 1 });
    // Frame 340 is frame 40 of the nest: c2 (from its file's frame 100) and the song.
    expect(wants.map((w) => [w.clipId, w.assetId, Number(w.seconds.toFixed(3)), w.volume])).toEqual([[`${id}/c2`, "a", Number((110 / 30).toFixed(3)), 0.5], [`${id}/m1`, "song", Number((40 / 30).toFixed(3)), 0.5]]);
    expect(mediaWants(d, 20, { playing: true, rate: 1 })).toEqual([]);
    expect(upcomingAssetIds(d, 290)).toEqual(["a", "song"]);
  });
  it("the export schedules their pictures and their sound, and asks for their files and fonts", () => {
    const { doc: d, id } = made();
    expect(exportAssetIds(d, true)).toEqual(["a", "song"]);
    const scheduled = mediaSchedule(d, { [`${id}/c1`]: { fileId: "f" }, [`${id}/c2`]: { fileId: "f" }, c3: { fileId: "f" } }).clips;
    expect(scheduled.map((c) => [c.clipId, c.start, c.end])).toEqual([["c3", 90, 120], [`${id}/c1`, 300, 330], [`${id}/c2`, 330, 360]]);
    expect(soundingClips(d).map((s) => [s.clip.id, s.clip.start, s.gain])).toEqual([["c3", 90, 1], [`${id}/c1`, 300, 0.5], [`${id}/c2`, 330, 0.5], [`${id}/m1`, 300, 0.5]]);
    expect(probeRequests(d, (family) => `"${family}"`).map((r) => r.text.endsWith("I"))).toEqual([true]); // "Intro" brings its capital I
  });
  it("a grade on a clip inside, or on the nest itself, calls for the graphics card", () => {
    const { doc: d, id } = made();
    expect(needsFinisher(d)).toBe(false);
    expect(needsFinisher(run(d, [{ op: "update_clip", clipId: id, patch: { adjust: { grain: 0.3 } } }]).doc)).toBe(true);
    const inside = structuredClone(d);
    (nestOf(inside).tracks[0].clips[0] as MediaClip).adjust = { grain: 0.3 };
    expect(needsFinisher(inside)).toBe(true);
  });
  it("the server checks the files a new nest names, and a project's files include its nests'", () => {
    const { doc: d, id } = made();
    expect(usedAssetIds(d)).toEqual(["a", "song"]);
    const add: Op[] = [{ op: "add_clip", trackId: "v1", clip: nestOf(d) }];
    expect(assetIdsToCheck(d, add)).toEqual(["a", "song"]);
    const fact = (kind: "video" | "audio", durationMs: number) => ({ kind, ready: true, removed: false, durationMs });
    const facts = new Map([["a", fact("video", 60_000)], ["song", fact("audio", 60_000)]]);
    expect(findMediaProblem(d, add, facts as never)).toBeNull();
    expect(findMediaProblem(d, add, new Map([["a", fact("video", 60_000)]]) as never)).toMatchObject({ code: "missing", assetId: "song", clipId: "m1", opIndex: 0 });
    expect(findMediaProblem(d, add, new Map([["a", fact("video", 60_000)], ["song", fact("video", 60_000)]]) as never)).toBeNull(); // an audio clip may play a video's sound
    expect(findMediaProblem(d, add, new Map([["a", fact("audio", 60_000)], ["song", fact("audio", 60_000)]]) as never)).toMatchObject({ code: "wrong_kind", assetId: "a", clipId: "c1" });
    // c2 plays its file from frame 100 to 130: a file of four seconds (120 frames) is too short.
    expect(findMediaProblem(d, add, new Map([["a", fact("video", 4_000)], ["song", fact("audio", 60_000)]]) as never)).toMatchObject({ code: "past_end", clipId: "c2", frames: 120 });
    expect(id).toBeTruthy();
  });
});
