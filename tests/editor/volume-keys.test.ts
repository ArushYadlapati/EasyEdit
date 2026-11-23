import { describe, expect, it } from "vitest";
import { createClipboard } from "@/lib/editor/clipboard";
import { toggleKeyframe } from "@/lib/editor/actions";
import { clipFieldOps, clipFieldValue, fieldContext } from "@/lib/editor/inspector-fields";
import { toggleKeyframeOps, writeVolumeOps } from "@/lib/editor/keyframe-edit";
import { clearKeyframesOps, deleteKeyframeOps, keyframeRows } from "@/lib/editor/keyframe-list";
import { mediaWants } from "@/lib/editor/media-plan";
import { MESSAGES } from "@/lib/editor/messages";
import { runCommand } from "@/lib/editor/run-command";
import { DUCK_LEVEL, duckOps } from "@/lib/editor/sound";
import { findClip } from "@/lib/editor/store";
import { applyGain } from "@/lib/export/mix";
import { soundSchedule } from "@/lib/export/sound-schedule";
import { clipSound, gainAt, soundGain } from "@/lib/render/clip-sound";
import { KEYFRAME_PROPS, TRANSFORM_PROPS, applyOps, effectiveTransform, prepareOps, propValue, volumeAt, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "./fixtures";

// The sample project (v1: c1 0-30, c2 30-60) with a song m1 on a1, frames 0 to 300, at 30 frames a second.
function songDoc(extra: Record<string, unknown> = {}, change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[3].clips = [video("m1", 0, 300, { type: "audio", assetId: "song", ...extra })];
  change(d);
  return d;
}
const clipOf = (d: TimelineDoc, id: string) => findClip(d, id)!.clip as MediaClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const keyed = (list: { at: number; value: number }[]) => ({ keyframes: { volume: list } });
const RAMP = keyed([{ at: 0, value: 1 }, { at: 100, value: 0 }]);

describe("a volume that changes over a clip", () => {
  it("is one of the properties a clip can key, apart from those of its picture", () => {
    expect(KEYFRAME_PROPS).toEqual(["x", "y", "scale", "rotation", "opacity", "volume"]);
    expect(TRANSFORM_PROPS).toEqual(["x", "y", "scale", "rotation", "opacity"]);
  });

  it("is read between its keyframes, and is the clip's volume without any", () => {
    const d = songDoc(RAMP);
    expect([0, 50, 100, 250].map((f) => volumeAt(clipOf(d, "m1"), f))).toEqual([1, 0.5, 0, 0]);
    expect(volumeAt(clipOf(songDoc({ volume: 0.7 }), "m1"), 40)).toBe(0.7);
    expect(volumeAt(clipOf(d, "x1"), 10)).toBe(0);
    expect(propValue(clipOf(d, "m1"), "volume", 50)).toBe(0.5);
    // A picture's keyframes never touch it, nor it them.
    expect(effectiveTransform(clipOf(d, "m1"), 50)).toBe(clipOf(d, "m1").transform);
  });

  it("is taken by video and audio clips only, within what a volume can be", () => {
    const d = songDoc();
    expect(() => run(d, [{ op: "update_clip", clipId: "c1", patch: RAMP }])).not.toThrow();
    expect(() => run(d, [{ op: "update_clip", clipId: "x1", patch: RAMP }])).toThrow(/only a video or audio clip takes volume keyframes/);
    expect(() => run(d, [{ op: "update_clip", clipId: "m1", patch: keyed([{ at: 0, value: 5 }]) }])).toThrow(/volume keyframes must be between 0 and 4/);
    expect(() => run(d, [{ op: "update_clip", clipId: "m1", patch: { keyframes: { opacity: [{ at: 0, value: 1 }] } } }])).toThrow(/an audio clip takes only volume keyframes/);
  });

  it("moves with a start trim and a split, like the others", () => {
    const d = songDoc(RAMP);
    const trimmed = run(d, [{ op: "trim_clip", clipId: "m1", edge: "start", to: 50 }]).doc;
    expect(clipOf(trimmed, "m1").keyframes!.volume).toEqual([{ at: -50, value: 1 }, { at: 50, value: 0 }]);
    expect(volumeAt(clipOf(trimmed, "m1"), 50)).toBe(0.5); // the same sound is as loud as it was
    const split = run(d, [{ op: "split_clip", clipId: "m1", at: 50, newClipId: "m2" }]).doc;
    expect(volumeAt(clipOf(split, "m2"), 50)).toBe(0.5);
  });
});

describe("keying a volume", () => {
  it("the diamond adds a keyframe with the volume there, and removing the last one keeps that volume", () => {
    const d = songDoc({ volume: 0.8 });
    const added = run(d, toggleKeyframeOps(clipOf(d, "m1"), "volume", 40)).doc;
    expect(clipOf(added, "m1").keyframes!.volume).toEqual([{ at: 40, value: 0.8 }]);
    const moved = run(added, writeVolumeOps(clipOf(added, "m1"), 40, 0.2)).doc;
    const removed = run(moved, toggleKeyframeOps(clipOf(moved, "m1"), "volume", 40)).doc;
    expect(clipOf(removed, "m1")).toMatchObject({ volume: 0.2, keyframes: { volume: [] } });
  });

  it("the Volume field shows the volume at the playhead and keys it there", () => {
    const d = songDoc(RAMP);
    const m1 = clipOf(d, "m1");
    expect(clipFieldValue(m1, "volume", fieldContext(d, m1, undefined, null, 50))).toBe("50");
    const after = run(d, clipFieldOps(m1, "volume", "80", fieldContext(d, m1, undefined, null, 50))!).doc;
    expect(clipOf(after, "m1").keyframes!.volume).toEqual([{ at: 0, value: 1 }, { at: 50, value: 0.8 }, { at: 100, value: 0 }]);
    expect(clipOf(after, "m1").volume).toBe(1);
    expect(clipFieldOps(m1, "volume", "50", fieldContext(d, m1, undefined, null, 50))).toEqual([]);
    // Without keyframes it sets the clip's volume, as before.
    const plain = songDoc();
    expect(clipFieldOps(clipOf(plain, "m1"), "volume", "80", fieldContext(plain, clipOf(plain, "m1"), undefined, null, 50))).toEqual([{ op: "update_clip", clipId: "m1", patch: { volume: 0.8 } }]);
  });

  it("is listed with the clip's other keyframes, and deleting or clearing it keeps the volume heard", () => {
    const d = songDoc(RAMP);
    expect(keyframeRows(clipOf(d, "m1"))).toEqual([{ prop: "volume", keyframes: RAMP.keyframes.volume }]);
    const cleared = run(d, clearKeyframesOps(clipOf(d, "m1"), "volume")).doc;
    expect(clipOf(cleared, "m1")).toMatchObject({ volume: 1, keyframes: { volume: [] } });
    const one = songDoc(keyed([{ at: 10, value: 0.3 }]));
    expect(clipOf(run(one, deleteKeyframeOps(clipOf(one, "m1"), "volume", 10)).doc, "m1").volume).toBe(0.3);
  });

  it("only a clip that sounds has a volume to key, and an audio clip nothing else", () => {
    const store = makeStore({ doc: songDoc() });
    toggleKeyframe(store, "x1", "volume");
    toggleKeyframe(store, "m1", "opacity");
    expect(store.getState().queue).toHaveLength(0);
    toggleKeyframe(store, "m1", "volume");
    toggleKeyframe(store, "c1", "volume");
    expect(store.getState().queue).toHaveLength(2);
  });
});

describe("hearing a keyed volume", () => {
  it("the preview follows it frame by frame, fades and all", () => {
    const d = songDoc(RAMP);
    const heard = (frame: number) => mediaWants(d, frame, { playing: true, rate: 1 }).find((w) => w.clipId === "m1")!.volume;
    expect([0, 50, 150].map(heard)).toEqual([1, 0.5, 0]);
    expect(gainAt(d.tracks[3], clipOf(d, "m1"), 50)).toBe(0.5);
    d.tracks[3].muted = true;
    expect(gainAt(d.tracks[3], clipOf(d, "m1"), 50)).toBe(0);
  });

  it("a clip whose volume is 0 but keyed up still sounds", () => {
    const d = songDoc({ volume: 0, ...keyed([{ at: 0, value: 0 }, { at: 30, value: 2 }]) });
    expect(soundGain(d.tracks[3], clipOf(d, "m1"))).toBe(2);
    expect(clipSound(d.tracks[3], clipOf(d, "m1"))).toEqual({ gain: 1 });
    const silent = songDoc(keyed([{ at: 0, value: 0 }]));
    expect(clipSound(silent.tracks[3], clipOf(silent, "m1"))).toBeNull();
  });

  it("the export gives the voice its keyframes in samples and a gain of 1", () => {
    const d = songDoc({ volume: 3, ...keyed([{ at: 30, value: 1 }, { at: 60, value: 0.5 }]) });
    const voice = soundSchedule(d, { m1: "f-song" }, 30, 48_000).voices.find((v) => v.clipIds[0] === "m1")!;
    expect(voice).toMatchObject({ gain: 1, envelope: [{ at: 48_000, value: 1 }, { at: 96_000, value: 0.5 }] });
    expect(soundSchedule(songDoc(), { m1: "f-song" }, 30, 48_000).voices.find((v) => v.clipIds[0] === "m1")!.envelope).toBeUndefined();
  });

  it("two clips that would run on as one voice stay two when either is keyed", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { in: 30 })];
    expect(soundSchedule(d, { c1: "f", c2: "f" }, 30, 48_000).voices).toHaveLength(1);
    (d.tracks[0].clips[1] as MediaClip).keyframes = { volume: [{ at: 0, value: 1 }] };
    expect(soundSchedule(d, { c1: "f", c2: "f" }, 30, 48_000).voices).toHaveLength(2);
  });

  it("the export shapes each sample between the keyframes", () => {
    const ones = () => ({ at: 0, left: new Float32Array(5).fill(1), right: new Float32Array(5).fill(1) });
    const envelope = [{ at: 10_000, value: 1 }, { at: 10_004, value: 0 }];
    const middle = ones();
    // Far from the voice's ends, so only the keyframes shape it: samples 9 999 to 10 003 of a long voice.
    applyGain(middle, 1, 9_999, 1_000_000, undefined, envelope);
    expect([...middle.left]).toEqual([1, 1, 0.75, 0.5, 0.25]);
    expect([...middle.right]).toEqual([...middle.left]);
    const after = ones();
    applyGain(after, 2, 20_000, 1_000_000, undefined, envelope);
    expect([...after.left]).toEqual([0, 0, 0, 0, 0]);
    const held = ones();
    applyGain(held, 1, 500_000, 1_000_000, undefined, [{ at: 0, value: 0.25, ease: "hold" }, { at: 900_000, value: 1 }]);
    expect([...held.left]).toEqual([0.25, 0.25, 0.25, 0.25, 0.25]);
    const plain = ones();
    applyGain(plain, 0.5, 500_000, 1_000_000);
    expect([...plain.left]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });
});

describe("Duck under speech", () => {
  const keys = (d: TimelineDoc, id = "m1") => clipOf(d, id).keyframes?.volume ?? [];
  const ducked = (d: TimelineDoc, ids = ["m1"]) => {
    const result = duckOps(d, ids);
    if (!result.ok) throw new Error(result.why);
    return run(d, result.ops).doc;
  };

  it("turns the music down while a video is heard over it, and back up after", () => {
    // c1 and c2 are heard from frame 0 to 60; the song runs to 300.
    const d = ducked(songDoc());
    expect(DUCK_LEVEL).toBe(0.25);
    expect(keys(d)).toEqual([{ at: 0, value: 0.25 }, { at: 59, value: 0.25 }, { at: 68, value: 1 }]);
    expect(clipOf(d, "m1").volume).toBe(1);
  });

  it("comes down before the speech when there is room", () => {
    const d = ducked(songDoc({}, (doc) => (doc.tracks[0].clips = [video("c1", 90, 60)])));
    expect(keys(d)).toEqual([{ at: 81, value: 1 }, { at: 90, value: 0.25 }, { at: 149, value: 0.25 }, { at: 158, value: 1 }]);
  });

  it("ducks from the clip's own volume, and stays down to its end when the speech outlasts it", () => {
    const d = ducked(songDoc({ volume: 0.6, duration: 40 }));
    expect(keys(d)).toEqual([{ at: 0, value: 0.15 }, { at: 39, value: 0.15 }]);
  });

  it("with captions, follows the words and comes back in a long pause", () => {
    const d = songDoc({}, (doc) => {
      doc.tracks[0].clips = [video("c1", 0, 300)];
      // Words at 1.0–2.0 s and, after a three-second pause, 5.0–6.0 s of the file.
      doc.captions = { transcripts: { a: [{ t: "hello", s: 1000, e: 1500 }, { t: "there", s: 1600, e: 2000 }, { t: "again", s: 5000, e: 6000 }] } };
    });
    expect(keys(ducked(d))).toEqual([
      { at: 21, value: 1 }, { at: 30, value: 0.25 }, { at: 59, value: 0.25 }, { at: 68, value: 1 },
      { at: 141, value: 1 }, { at: 150, value: 0.25 }, { at: 179, value: 0.25 }, { at: 188, value: 1 },
    ]);
  });

  it("does not count muted tracks, silent clips or the selection itself", () => {
    expect(duckOps(songDoc({}, (d) => (d.tracks[0].muted = true)), ["m1"])).toEqual({ ok: false, why: "silent" });
    expect(duckOps(songDoc({}, (d) => d.tracks[0].clips.forEach((c) => ((c as MediaClip).volume = 0))), ["m1"])).toEqual({ ok: false, why: "silent" });
    expect(duckOps(songDoc(), ["m1", "c1", "c2"])).toEqual({ ok: false, why: "silent" });
    expect(duckOps(songDoc(), ["x1"])).toEqual({ ok: false, why: "nothing" });
    expect(duckOps(songDoc({}, (d) => (d.tracks[3].locked = true)), ["m1"])).toEqual({ ok: false, why: "nothing" });
  });

  it("replaces keyframes the clip already had", () => {
    const d = ducked(songDoc(RAMP));
    expect(keys(d)).toEqual([{ at: 0, value: 0.25 }, { at: 59, value: 0.25 }, { at: 68, value: 1 }]);
  });

  it("runs from its key, says what it did and undoes in one step", () => {
    const store = makeStore({ doc: songDoc() });
    const notices = noticesOf(store);
    const ctx = { store, clipboard: createClipboard(), openShortcuts: () => {} };
    runCommand("duck-audio", ctx);
    store.getState().select(["m1"]);
    runCommand("duck-audio", ctx);
    expect(notices).toEqual([MESSAGES.nothingToDuck, MESSAGES.ducked(1)]);
    expect(keys(store.getState().doc)).toHaveLength(3);
    store.getState().undo();
    expect(keys(store.getState().doc)).toHaveLength(0);
  });
});
