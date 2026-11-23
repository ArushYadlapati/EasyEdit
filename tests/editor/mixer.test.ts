import { describe, expect, it } from "vitest";
import { clipFieldOps, clipFieldValue, fieldContext } from "@/lib/editor/inspector-fields";
import { mediaWants } from "@/lib/editor/media-plan";
import { findClip } from "@/lib/editor/store";
import { applyGain } from "@/lib/export/mix";
import { soundSchedule } from "@/lib/export/sound-schedule";
import { clipSound, gainAt, panGains, panOf, soundGain, trackGain } from "@/lib/render/clip-sound";
import { applyOps, prepareOps, type MediaClip, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// The sample project (v1: c1 0-30, c2 30-60) with a song m1 on a1.
function songDoc(extra: Record<string, unknown> = {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[3].clips = [video("m1", 0, 300, { type: "audio", assetId: "song", ...extra })];
  return d;
}
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));
const m1 = (d: TimelineDoc) => findClip(d, "m1")!.clip as MediaClip;
const near = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

describe("a track's volume", () => {
  it("is 1 until it is set, and an undo takes it back there", () => {
    const d = songDoc();
    expect(trackGain(d.tracks[3])).toBe(1);
    const set = run(d, [{ op: "update_track", trackId: "a1", patch: { volume: 0.5 } }]);
    expect(set.doc.tracks[3].volume).toBe(0.5);
    expect(set.inverse).toEqual([{ op: "update_track", trackId: "a1", patch: { volume: 1 }, expect: { volume: 0.5 } }]);
    expect(trackGain(applyOps(set.doc, roundTrip(set.inverse)).doc.tracks[3])).toBe(1);
    expect(() => run(d, [{ op: "update_track", trackId: "a1", patch: { volume: 9 } }])).toThrow();
    // A track never touched expects 1.
    expect(() => run(d, [{ op: "update_track", trackId: "a1", patch: { volume: 2 }, expect: { volume: 1 } }])).not.toThrow();
    expect(() => run(d, [{ op: "update_track", trackId: "a1", patch: { volume: 2 }, expect: { volume: 0.3 } }])).toThrow();
  });

  it("leaves a rename's undo as it was", () => {
    const renamed = run(songDoc(), [{ op: "update_track", trackId: "a1", patch: { name: "Music" } }]);
    expect(renamed.inverse).toEqual([{ op: "update_track", trackId: "a1", patch: { name: "Audio 1" }, expect: { name: "Music" } }]);
    expect(renamed.doc.tracks[3].volume).toBeUndefined();
  });

  it("scales every clip on the track, in the preview and the export, keyframes too", () => {
    const d = run(songDoc({ volume: 0.8 }), [{ op: "update_track", trackId: "a1", patch: { volume: 0.5 } }]).doc;
    expect(soundGain(d.tracks[3], m1(d))).toBeCloseTo(0.4);
    expect(gainAt(d.tracks[3], m1(d), 10)).toBeCloseTo(0.4);
    expect(mediaWants(d, 10, { playing: true, rate: 1 }).find((w) => w.clipId === "m1")!.volume).toBeCloseTo(0.4);
    expect(clipSound(d.tracks[3], m1(d))!.gain).toBeCloseTo(0.4);
    const keyed = run(d, [{ op: "update_clip", clipId: "m1", patch: { keyframes: { volume: [{ at: 0, value: 1 }, { at: 100, value: 0 }] } } }]).doc;
    expect(gainAt(keyed.tracks[3], m1(keyed), 50)).toBeCloseTo(0.25);
    expect(clipSound(keyed.tracks[3], m1(keyed))).toEqual({ gain: 0.5 }); // the keyframes shape it from there
    const silent = run(d, [{ op: "update_track", trackId: "a1", patch: { volume: 0 } }]).doc;
    expect(clipSound(silent.tracks[3], m1(silent))).toBeNull();
  });
});

describe("a clip's pan", () => {
  it("is set on clips that sound, within −1 and 1, and undone to the middle", () => {
    const d = songDoc();
    const set = run(d, [{ op: "update_clip", clipId: "m1", patch: { pan: -0.5 } }]);
    expect(panOf(m1(set.doc))).toBe(-0.5);
    expect(panOf(m1(applyOps(set.doc, roundTrip(set.inverse)).doc))).toBe(0);
    expect(() => run(d, [{ op: "update_clip", clipId: "m1", patch: { pan: 2 } }])).toThrow(/pan/);
    expect(() => run(d, [{ op: "update_clip", clipId: "x1", patch: { pan: 0.5 } }])).toThrow(/"pan" is not allowed on a text clip/);
    expect(panOf(d.tracks[1].clips[0])).toBe(0);
  });

  it("moves a stereo sound as a browser's panner does", () => {
    expect(panGains(0)).toEqual({ ll: 1, lr: 0, rl: 0, rr: 1 });
    // All the way left: both sides come out of the left, nothing out of the right.
    const left = panGains(-1);
    near([left.ll, left.lr, left.rl, left.rr], [1, 1, 0, 0]);
    const right = panGains(1);
    near([right.ll, right.lr, right.rl, right.rr], [0, 0, 1, 1]);
    const half = panGains(0.5);
    near([half.ll, half.lr, half.rl, half.rr], [Math.SQRT1_2, 0, Math.SQRT1_2, 1]);
    expect(panGains(5)).toEqual(panGains(1));
  });

  it("reaches the preview only when it is off the middle, and the export's voice", () => {
    const plain = mediaWants(songDoc(), 10, { playing: true, rate: 1 }).find((w) => w.clipId === "m1")!;
    expect("pan" in plain).toBe(false);
    const d = songDoc({ pan: 0.25 });
    expect(mediaWants(d, 10, { playing: true, rate: 1 }).find((w) => w.clipId === "m1")!.pan).toBe(0.25);
    expect(soundSchedule(d, { m1: "f" }, 30, 48_000).voices.find((v) => v.clipIds[0] === "m1")!.pan).toBe(0.25);
    expect(soundSchedule(songDoc(), { m1: "f" }, 30, 48_000).voices.find((v) => v.clipIds[0] === "m1")!.pan).toBeUndefined();
  });

  it("two clips that would run on as one voice stay two when their pans differ", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { in: 30, pan: 0.5 })];
    expect(soundSchedule(d, { c1: "f", c2: "f" }, 30, 48_000).voices).toHaveLength(2);
  });

  it("the export moves each sample the same way", () => {
    const part = () => ({ at: 0, left: Float32Array.of(1, 1), right: Float32Array.of(0.5, 0.5) });
    const left = part();
    // Far from the voice's ends, at half gain, all the way left: the right side joins the left.
    applyGain(left, 0.5, 500_000, 1_000_000, undefined, undefined, -1);
    near([...left.left, ...left.right], [0.75, 0.75, 0, 0]);
    const right = part();
    applyGain(right, 1, 500_000, 1_000_000, undefined, undefined, 1);
    near([...right.left, ...right.right], [0, 0, 1.5, 1.5]);
    const centre = part();
    applyGain(centre, 1, 500_000, 1_000_000);
    expect([...centre.left, ...centre.right]).toEqual([1, 1, 0.5, 0.5]);
  });

  it("is a percent in the inspector, left below 0 and right above", () => {
    const d = songDoc({ pan: -0.3 });
    expect(clipFieldValue(m1(d), "pan", fieldContext(d, m1(d)))).toBe("-30");
    expect(clipFieldOps(m1(d), "pan", "250", fieldContext(d, m1(d)))).toEqual([{ op: "update_clip", clipId: "m1", patch: { pan: 1 } }]);
    expect(clipFieldOps(m1(d), "pan", "-30", fieldContext(d, m1(d)))).toEqual([]);
    expect(clipFieldOps(d.tracks[1].clips[0], "pan", "10", fieldContext(d, d.tracks[1].clips[0]))).toBeNull();
  });
});
