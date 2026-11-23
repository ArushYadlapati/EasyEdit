import { describe, expect, it } from "vitest";
import { captionOps } from "@/lib/captions/actions";
import { FILLERS, PAUSE_KEEP_SECONDS, PAUSE_SECONDS, cutMessage, cutOps, cuttable, fillerRanges, pauseRanges, runCut, wordRange, wordRanges } from "@/lib/captions/cut";
import { docCues } from "@/lib/captions/cues";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/types";
import { findClip } from "@/lib/editor/store";
import { applyOps, prepareOps, type CaptionWord, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "../editor/fixtures";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
// At 30 fps a word's milliseconds are frames × 33.3: "so" is frames 0–15, "um" 15–24, "we" 30–45, then a two-second
// pause, "built" 105–120 and "it." 120–135.
const WORDS = [w("so", 0, 500), w("Um,", 500, 800), w("we", 1000, 1500), w("built", 3500, 4000), w("it.", 4000, 4500)];

// v1 holds c1 (frames 0 to 150 of the timeline and of its file) with captions on, then c2 right after it.
function spoken(extra: Record<string, unknown> = {}, change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 0, 150, extra), video("c2", 150, 30, { assetId: "b" })];
  change(doc);
  return applyOps(doc, prepareOps(captionOps(doc, { assetId: "a", words: WORDS, clipIds: ["c1"], fonts: DEFAULT_BRAND_KIT.fonts }), () => "cap")).doc;
}
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const row = (d: TimelineDoc) => d.tracks[0].clips.map((c) => [c.id, c.start, c.duration, (c as MediaClip).in]);
const said = (d: TimelineDoc) => docCues(d).flatMap((cue) => cue.words.map((word) => word.text));

describe("where a word is on the timeline", () => {
  it("follows the clip's in point and speed, and stays inside the clip", () => {
    const clip = findClip(spoken(), "c1")!.clip as MediaClip;
    expect(wordRange(clip, WORDS[2], 30)).toEqual({ clipId: "c1", from: 30, to: 45 });
    expect(wordRange({ ...clip, start: 100, in: 15 }, WORDS[2], 30)).toEqual({ clipId: "c1", from: 115, to: 130 });
    expect(wordRange({ ...clip, speed: 2, duration: 75 }, WORDS[2], 30)).toEqual({ clipId: "c1", from: 15, to: 23 });
    expect(wordRange({ ...clip, duration: 40 }, WORDS[2], 30)).toEqual({ clipId: "c1", from: 30, to: 40 });
    expect(wordRange({ ...clip, duration: 20 }, WORDS[2], 30)).toBeNull();
  });
});

describe("cutting picked words", () => {
  it("takes a word out of the middle and closes the gap, on its own track", () => {
    const d = spoken();
    const cut = cutOps(d, wordRanges(d, [{ clipId: "c1", index: 2 }]), ids());
    expect(cut).toMatchObject({ parts: 1, frames: 15 });
    const after = run(d, cut.ops);
    expect(row(after.doc)).toEqual([["c1", 0, 30, 0], ["n1", 30, 105, 45], ["c2", 135, 30, 0]]);
    expect(said(after.doc)).toEqual(["so", "Um,", "built", "it."]);
    expect(after.doc.tracks[1]).toEqual(d.tracks[1]); // the text track did not move
    expect(applyOps(after.doc, after.inverse).doc).toEqual(d);
  });

  it("joins words that touch into one cut, and cuts from the end so nothing moves under a later cut", () => {
    const d = spoken();
    const cut = cutOps(d, wordRanges(d, [{ clipId: "c1", index: 4 }, { clipId: "c1", index: 0 }, { clipId: "c1", index: 1 }]), ids());
    expect(cut).toMatchObject({ parts: 2, frames: 24 + 15 });
    const after = run(d, cut.ops).doc;
    // "it." ran to frame 135 and "so um" from the clip's start: frames 24 to 120 and 135 to 150 of the file are left.
    expect(after.tracks[0].clips.map((c) => [c.start, c.duration, (c as MediaClip).in])).toEqual([[0, 96, 24], [96, 15, 135], [111, 30, 0]]);
    expect(said(after)).toEqual(["we", "built"]);
  });

  it("every word of a clip removes the clip", () => {
    const d = spoken({ duration: 20 }, (doc) => (doc.tracks[0].clips[1].start = 20));
    const cut = cutOps(d, [{ clipId: "c1", from: 0, to: 20 }], ids());
    expect(cut.ops).toEqual([{ op: "remove_clip", clipId: "c1", ripple: true }]);
    expect(row(run(d, cut.ops).doc)).toEqual([["c2", 0, 30, 0]]);
  });

  it("leaves out what it cannot cut: a missing clip, a locked track, a range outside the clip", () => {
    const d = spoken();
    expect(cutOps(d, [{ clipId: "gone", from: 0, to: 10 }, { clipId: "c1", from: 500, to: 600 }], ids())).toEqual({ ops: [], parts: 0, frames: 0 });
    d.tracks[0].locked = true;
    expect(cutOps(d, [{ clipId: "c1", from: 30, to: 45 }], ids()).ops).toEqual([]);
    expect(wordRanges(d, [{ clipId: "x1", index: 0 }, { clipId: "c1", index: 99 }])).toEqual([]);
  });

  it("cuts in two clips at once, each in its own place", () => {
    const d = spoken({}, (doc) => {
      doc.tracks[0].clips[1] = video("c2", 150, 150);
    });
    const withBoth = run(d, [{ op: "update_clip", clipId: "c2", patch: { captions: true } }]).doc;
    const cut = cutOps(withBoth, wordRanges(withBoth, [{ clipId: "c1", index: 2 }, { clipId: "c2", index: 2 }]), ids());
    const after = run(withBoth, cut.ops).doc;
    expect(after.tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([[0, 30], [30, 105], [135, 30], [165, 105]]);
  });
});

describe("cutting pauses and filler words", () => {
  it("finds the silences worth cutting and keeps a breath either side", () => {
    expect([PAUSE_SECONDS, PAUSE_KEEP_SECONDS]).toEqual([0.6, 0.12]);
    // Only the two seconds between "we" (ends at frame 45) and "built" (starts at 105) are long enough.
    expect(pauseRanges(spoken())).toEqual([{ clipId: "c1", from: 49, to: 101 }]);
  });

  it("measures a pause as it is heard at the clip's speed", () => {
    // At four times the speed the two seconds last half a second: not a pause any more.
    expect(pauseRanges(spoken({ speed: 4, duration: 37 }))).toEqual([]);
  });

  it("finds the fillers whatever their case and punctuation", () => {
    expect(fillerRanges(spoken())).toEqual([{ clipId: "c1", from: 15, to: 24 }]);
    expect(FILLERS.has("um") && FILLERS.has("uh") && !FILLERS.has("like")).toBe(true);
  });

  it("works on the selected captioned clips, else on all of them, and never on a clip that plays backward", () => {
    const d = spoken();
    expect(cuttable(d).map(({ clip }) => clip.id)).toEqual(["c1"]);
    expect(cuttable(d, ["c2", "x1"]).map(({ clip }) => clip.id)).toEqual(["c1"]); // nothing cuttable is selected
    expect(cuttable(spoken({ speed: -1, in: 149 }))).toEqual([]);
    d.tracks[0].locked = true;
    expect(cuttable(d)).toEqual([]);
  });

  it("is one change that says how much went, and one undo", () => {
    const store = makeStore({ doc: spoken() });
    const notices = noticesOf(store);
    expect(runCut(store, (d) => pauseRanges(d), ids(), "No long pauses to cut.", "cut pauses")).toBe(true);
    expect(notices).toEqual(["Cut 1 part, 1.7 s shorter."]);
    expect(store.getState().queue.at(-1)).toMatchObject({ label: "cut pauses" });
    expect(runCut(store, (d) => pauseRanges(d), ids(), "No long pauses to cut.")).toBe(false);
    expect(notices.at(-1)).toBe("No long pauses to cut.");
    store.getState().undo();
    expect(row(store.getState().doc)[0]).toEqual(["c1", 0, 150, 0]);
    expect(cutMessage({ ops: [], parts: 3, frames: 45 }, 30)).toBe("Cut 3 parts, 1.5 s shorter.");
  });

  it("a viewer cuts nothing", () => {
    const store = makeStore({ doc: spoken(), canEdit: false });
    expect(runCut(store, (d) => fillerRanges(d), ids(), "none")).toBe(false);
    expect(store.getState().queue).toHaveLength(0);
  });
});
