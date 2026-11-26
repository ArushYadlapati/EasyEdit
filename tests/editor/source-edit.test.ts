import { describe, expect, it } from "vitest";
import { mediaClipFor } from "@/lib/editor/media-clips";
import { clearSpanOps, markedSpan, sourceEditOps, sourceTracks } from "@/lib/editor/source-edit";
import { DEFAULT_TRANSFORM, applyOps, prepareOps, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// v1 [a 0–60, b 60–120, c 150–210] · t1 · cap · a1 [m 0–90]
function doc(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("a", 0, 60), video("b", 60, 60, { in: 100 }), video("c", 150, 60)];
  d.tracks[3].clips = [video("m", 0, 90, { type: "audio", assetId: "song" })];
  change(d);
  return d;
}
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};
// A new clip of 30 frames from frame 40 of its file, to go at `start`.
const fresh = (start: number, duration = 30, type: MediaClip["type"] = "video") =>
  ({ type, assetId: "z", start, duration, in: 40, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } }) as Omit<MediaClip, "id">;
const row = (d: TimelineDoc, track = 0) => d.tracks[track].clips.map((c) => [c.id, c.start, c.duration, (c as MediaClip).in]);
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));

describe("where a clip from the source monitor can go", () => {
  it("is every unlocked track that takes its kind, in the project's order", () => {
    expect(sourceTracks(doc(), "video").map((t) => t.id)).toEqual(["v1"]);
    expect(sourceTracks(doc(), "image").map((t) => t.id)).toEqual(["v1"]);
    expect(sourceTracks(doc(), "audio").map((t) => t.id)).toEqual(["a1"]);
    expect(sourceTracks(doc((d) => void (d.tracks[0].locked = true)), "video")).toEqual([]);
  });
});

describe("overwrite", () => {
  const over = (start: number, duration = 30, d = doc()) => {
    const edit = sourceEditOps(d, fresh(start, duration), "v1", "overwrite", ids());
    if (!edit.ok) throw new Error(edit.why);
    const applied = run(d, edit.ops);
    return { edit, after: applied.doc, undone: applyOps(applied.doc, applied.inverse).doc };
  };
  it("goes into a gap without touching anything", () => {
    const { edit, after } = over(120);
    expect(edit.ops).toEqual([{ op: "add_clip", trackId: "v1", clip: { ...fresh(120), id: "n1" } }]);
    expect(row(after)).toEqual([["a", 0, 60, 0], ["b", 60, 60, 100], ["n1", 120, 30, 40], ["c", 150, 60, 0]]);
  });
  it("trims the clip it starts inside and the clip it ends inside, and removes one it covers", () => {
    // From 30 to 160: the end of a, all of b, the gap, and the first ten frames of c.
    const { after, undone } = over(30, 130);
    expect(row(after)).toEqual([["a", 0, 30, 0], ["n1", 30, 130, 40], ["c", 160, 50, 10]]);
    expect(undone).toEqual(doc());
  });
  it("cuts a clip in two around it when it lands in its middle, keeping each part on its own footage", () => {
    const { after, undone } = over(70, 30);
    // b played its file from 100: its start keeps 100, and its later part plays from 100 + 40.
    expect(row(after)).toEqual([["a", 0, 60, 0], ["b", 60, 10, 100], ["n1", 70, 30, 40], ["n2", 100, 20, 140], ["c", 150, 60, 0]]);
    expect(undone).toEqual(doc());
  });
  it("moves nothing that it does not cover, on this track or any other", () => {
    const { after } = over(70, 30);
    expect(row(after).at(-1)).toEqual(["c", 150, 60, 0]);
    expect(row(after, 3)).toEqual([["m", 0, 90, 0]]);
  });
});

describe("insert", () => {
  const insert = (start: number, duration = 30, d = doc()) => {
    const edit = sourceEditOps(d, fresh(start, duration), "v1", "insert", ids());
    if (!edit.ok) throw new Error(edit.why);
    const applied = run(d, edit.ops);
    return { edit, after: applied.doc, undone: applyOps(applied.doc, applied.inverse).doc };
  };
  it("at a cut, pushes everything from there on later by its length", () => {
    const { after, undone } = insert(60);
    expect(row(after)).toEqual([["a", 0, 60, 0], ["n1", 60, 30, 40], ["b", 90, 60, 100], ["c", 180, 60, 0]]);
    expect(undone).toEqual(doc());
  });
  it("inside a clip, cuts it there first, so its later part moves with the rest", () => {
    const { after, undone } = insert(80);
    expect(row(after)).toEqual([["a", 0, 60, 0], ["b", 60, 20, 100], ["n1", 80, 30, 40], ["n2", 110, 40, 120], ["c", 180, 60, 0]]);
    expect(undone).toEqual(doc());
  });
  it("in a gap, moves what follows and leaves what came before", () => {
    expect(row(insert(130).after)).toEqual([["a", 0, 60, 0], ["b", 60, 60, 100], ["n1", 130, 30, 40], ["c", 180, 60, 0]]);
    expect(row(insert(400).after).at(-1)).toEqual(["n1", 400, 30, 40]);
  });
  it("moves only its own track", () => {
    expect(row(insert(0).after, 3)).toEqual([["m", 0, 90, 0]]);
  });
});

describe("the track it goes on", () => {
  it("is the first that takes it when none is named, and a new one when there is none", () => {
    const first = sourceEditOps(doc(), fresh(300, 30, "audio"), null, "overwrite", ids());
    expect(first).toMatchObject({ ok: true, trackId: "a1" });
    const none = doc((d) => void (d.tracks = d.tracks.filter((t) => t.kind !== "audio")));
    const made = sourceEditOps(none, fresh(0, 30, "audio"), null, "insert", ids());
    if (!made.ok) throw new Error(made.why);
    const after = run(none, made.ops).doc;
    const track = after.tracks.find((t) => t.id === made.trackId)!;
    expect([track.kind, track.name, track.clips.map((c) => c.id)]).toEqual(["audio", "Audio 1", [made.clipId]]);
  });
  it("is refused when it is locked, or does not take that kind of clip", () => {
    expect(sourceEditOps(doc((d) => void (d.tracks[0].locked = true)), fresh(0), "v1", "insert", ids())).toEqual({ ok: false, why: "locked" });
    expect(sourceEditOps(doc(), fresh(0), "a1", "insert", ids())).toEqual({ ok: false, why: "wrong-track" });
    expect(sourceEditOps(doc(), fresh(0), "gone", "overwrite", ids())).toEqual({ ok: false, why: "wrong-track" });
  });
});

describe("clearing a span of a track", () => {
  it("does nothing where the span is empty or only touches a clip's edge", () => {
    const track = doc().tracks[0];
    expect(clearSpanOps(track, 120, 150, ids())).toEqual([]);
    expect(clearSpanOps(track, 60, 60, ids())).toEqual([]);
  });
});

describe("the part of a file that is marked", () => {
  it("is from In to Out, held inside the file and at least a frame long", () => {
    expect(markedSpan(2, 5, 10, 30)).toEqual({ inSeconds: 2, durationSeconds: 3 });
    expect(markedSpan(-1, 99, 10, 30)).toEqual({ inSeconds: 0, durationSeconds: 10 });
    // Out at or before In: one frame from In.
    expect(markedSpan(4, 4, 10, 30).durationSeconds).toBeCloseTo(1 / 30, 6);
    expect(markedSpan(4, 1, 10, 30).durationSeconds).toBeCloseTo(1 / 30, 6);
    // In at the very end: the last frame.
    const last = markedSpan(10, 10, 10, 30);
    expect(last.inSeconds).toBeCloseTo(10 - 1 / 30, 6);
    expect(last.inSeconds + last.durationSeconds).toBeCloseTo(10, 6);
  });
  it("for an image is how long it shows", () => {
    expect(markedSpan(0, 4, null, 30)).toEqual({ inSeconds: 0, durationSeconds: 4 });
    expect(markedSpan(0, 0, null, 30).durationSeconds).toBeCloseTo(1 / 30, 6);
  });
  it("makes the clip that mediaClipFor makes from it", () => {
    const span = markedSpan(2, 5, 10, 30);
    expect(mediaClipFor({ id: "z", kind: "video", durationMs: 10_000 }, 90, 30, span)).toMatchObject({ assetId: "z", start: 90, in: 60, duration: 90 });
  });
});
