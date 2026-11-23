import { describe, expect, it } from "vitest";
import { LIMIT_CEILING, createLimiter } from "@/lib/audio/clean-dsp";
import { mediaWants } from "@/lib/editor/media-plan";
import { findClip } from "@/lib/editor/store";
import { mixParts } from "@/lib/export/mix";
import { audioBlocks } from "@/lib/export/schedule";
import { createSoundPool } from "@/lib/export/sound-pool";
import { soundSchedule } from "@/lib/export/sound-schedule";
import { fxOf } from "@/lib/render/clip-sound";
import { applyOps, prepareOps, type Clip, type MediaClip, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { fakeSoundIO, file } from "./fakes";

// The sample project (v1: c1 0-30, c2 30-60) with a song m1 on a1.
function songDoc(extra: Record<string, unknown> = {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[3].clips = [video("m1", 0, 60, { type: "audio", assetId: "song", ...extra })];
  return d;
}
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));
const m1 = (d: TimelineDoc) => findClip(d, "m1")!.clip as MediaClip;
const FILES = { song: file("song.mp3"), "prev-a": file("a.mp4") };

describe("a clip's sound clean-up in the ops", () => {
  it("is set a part at a time, keeps the rest, and an undo turns a first-time part off again", () => {
    const d = songDoc();
    const one = run(d, [{ op: "update_clip", clipId: "m1", patch: { sound: { bass: 4 } } }]);
    const two = run(one.doc, [{ op: "update_clip", clipId: "m1", patch: { sound: { lowCut: true, gate: 0.4 } } }]);
    expect(m1(two.doc).sound).toEqual({ bass: 4, lowCut: true, gate: 0.4 });
    expect(m1(applyOps(two.doc, roundTrip(two.inverse)).doc).sound).toEqual({ bass: 4, lowCut: false, gate: 0 });
    expect(fxOf(m1(applyOps(one.doc, roundTrip(one.inverse)).doc))).toBeNull();
  });

  it("stays in range, on clips that sound", () => {
    const d = songDoc();
    expect(() => run(d, [{ op: "update_clip", clipId: "m1", patch: { sound: { bass: 13 } } }])).toThrow(/bass/);
    expect(() => run(d, [{ op: "update_clip", clipId: "m1", patch: { sound: { gate: 2 } } }])).toThrow(/gate/);
    expect(() => run(d, [{ op: "update_clip", clipId: "m1", patch: { sound: { reverb: 1 } } }])).toThrow();
    expect(() => run(d, [{ op: "update_clip", clipId: "x1", patch: { sound: { bass: 1 } } }])).toThrow(/"sound" is not allowed on a text clip/);
    expect(() => run(d, [{ op: "update_clip", clipId: "c1", patch: { sound: { treble: -3 } } }])).not.toThrow();
  });

  it("an expect guards one part, and one never set counts as off", () => {
    const guarded: OpInput[] = [{ op: "update_clip", clipId: "m1", patch: { sound: { compress: 0.5 } }, expect: { sound: { compress: 0 } } }];
    const after = run(songDoc(), guarded).doc;
    expect(m1(after).sound?.compress).toBe(0.5);
    expect(() => run(after, guarded)).toThrow();
  });

  it("is nothing to process while every part is off", () => {
    expect(fxOf(m1(songDoc()))).toBeNull();
    expect(fxOf(m1(songDoc({ sound: {} })))).toBeNull();
    expect(fxOf(m1(songDoc({ sound: { bass: 0, gate: 0, lowCut: false } })))).toBeNull();
    expect(fxOf(m1(songDoc({ sound: { mid: 3 } })))).toEqual({ lowCut: false, gate: 0, bass: 0, mid: 3, treble: 0, compress: 0 });
    expect(fxOf(songDoc().tracks[1].clips[0])).toBeNull(); // a text clip
  });
});

describe("the clean-up on its way to the preview and the export", () => {
  it("reaches the preview's plan and the export's voice only where it is on", () => {
    const plain = songDoc();
    const cleaned = songDoc({ sound: { lowCut: true, mid: 3 } });
    const want = (d: TimelineDoc) => mediaWants(d, 10, { playing: true, rate: 1 }).find((w) => w.clipId === "m1")!;
    expect("fx" in want(plain)).toBe(false);
    expect(want(cleaned).fx).toEqual({ lowCut: true, gate: 0, bass: 0, mid: 3, treble: 0, compress: 0 });
    const voice = (d: TimelineDoc) => soundSchedule(d, { m1: "song" }, 30, 48_000).voices.find((v) => v.clipIds[0] === "m1")!;
    expect(voice(plain).fx).toBeUndefined();
    expect(voice(cleaned).fx).toEqual(want(cleaned).fx);
  });

  it("two clips that would run on as one voice stay two when their clean-up differs, and one when it is the same", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 0, 30, { sound: { bass: 3 } }), video("c2", 30, 30, { in: 30, sound: { bass: 3 } })];
    expect(soundSchedule(d, { c1: "f", c2: "f" }, 30, 48_000).voices).toHaveLength(1);
    (d.tracks[0].clips[1] as MediaClip).sound = { bass: 4 };
    expect(soundSchedule(d, { c1: "f", c2: "f" }, 30, 48_000).voices).toHaveLength(2);
  });

  it("the export cleans a voice's sound before its volume, and carries on from block to block", async () => {
    const song = (extra: Record<string, unknown>) => [video("m1", 0, 60, { type: "audio", assetId: "song", ...extra }) as Clip];
    const mixOf = async (extra: Record<string, unknown>) => {
      const d = sampleDoc();
      d.tracks[0].clips = [];
      d.tracks[3].clips = song(extra);
      const pool = createSoundPool(soundSchedule(d, { m1: "song" }, 30, 48_000), FILES, fakeSoundIO()); // the fake file is 0.5 everywhere
      await pool.open();
      const out: number[] = [];
      for (const block of audioBlocks(60, 30, 48_000)) out.push(...(await pool.block(block)));
      return out;
    };
    const plain = await mixOf({});
    expect(plain[40_000]).toBe(0.5);
    // A steady 0.5 has nothing but rumble in it: the rumble filter takes it away.
    const cut = await mixOf({ sound: { lowCut: true } });
    expect(Math.abs(cut[100_000])).toBeLessThan(0.001);
    expect(Math.abs(cut[150_000])).toBeLessThan(0.001); // in the second block too: no jump at the join
    // The volume is set on what the clean-up leaves.
    const louder = await mixOf({ sound: { compress: 0.5 }, volume: 0.5 });
    const compressed = await mixOf({ sound: { compress: 0.5 } });
    expect(louder[100_000]).toBeCloseTo(compressed[100_000] / 2, 5);
  });
});

describe("the limiter on the export's mix", () => {
  const part = (level: number, count = 48_000) => ({ at: 0, left: new Float32Array(count).fill(level), right: new Float32Array(count).fill(level) });

  it("holds a mix that would pass the ceiling, where the clamp alone would chop it flat at 1", () => {
    const clamped = mixParts(48_000, [part(0.8), part(0.8)]);
    expect(clamped[1000]).toBe(1);
    const limited = mixParts(48_000, [part(0.8), part(0.8)], createLimiter(48_000));
    expect(limited[1000]).toBeCloseTo(LIMIT_CEILING, 5);
    expect(Math.max(...limited)).toBeLessThanOrEqual(LIMIT_CEILING + 1e-6);
  });

  it("leaves a mix under the ceiling exactly as the sum", () => {
    expect(mixParts(4, [part(0.25, 4), part(0.5, 4)], createLimiter(48_000))).toEqual(mixParts(4, [part(0.25, 4), part(0.5, 4)]));
  });

  it("is not thrown by a sample that is no number", () => {
    const bad = part(0.5, 4);
    bad.left[1] = NaN;
    const limiter = createLimiter(48_000);
    expect([...mixParts(4, [bad], limiter)]).toEqual([0.5, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect([...mixParts(2, [part(0.5, 2)], limiter)]).toEqual([0.5, 0.5, 0.5, 0.5]); // still working after it
  });

  it("is on in every export: a clip turned up to 400% is held, not clipped", async () => {
    const d = sampleDoc();
    d.tracks[0].clips = [];
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio", assetId: "song", volume: 4 }) as Clip];
    const pool = createSoundPool(soundSchedule(d, { m1: "song" }, 30, 48_000), FILES, fakeSoundIO()); // 0.5 × 4 = 2
    await pool.open();
    const [block] = audioBlocks(30, 30, 48_000);
    const mix = await pool.block(block);
    expect(mix[20_000]).toBeCloseTo(LIMIT_CEILING, 5);
  });
});
