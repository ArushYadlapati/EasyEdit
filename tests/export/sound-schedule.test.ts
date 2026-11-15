import { describe, expect, it } from "vitest";
import { frameCount } from "@/lib/export/schedule";
import { SOURCE_MARGIN_SECONDS, soundSchedule, sourceAt, voiceWindow } from "@/lib/export/sound-schedule";
import { sourceSeconds } from "@/lib/render/source-time";
import { DEFAULT_TRANSFORM, type Clip, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";

const S = 48_000;
const song = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  video(id, start, duration, { type: "audio", assetId: "song", ...extra });
// v1 holds the video clips, a1 the audio clips
function doc(v1: Clip[] = [], a1: Clip[] = []): TimelineDoc {
  const d = docWithCaptions("short_9x16");
  d.tracks[0].clips = v1;
  d.tracks[3].clips = a1;
  return d;
}
const ids = (d: TimelineDoc, sounds: Record<string, string>) => soundSchedule(d, sounds, 30, S).voices.map((v) => v.clipIds);

describe("where each clip sounds", () => {
  it("puts a clip on the samples of its frames and starts its file at its in point", () => {
    const s = soundSchedule(doc([video("c1", 2, 3, { in: 30 })]), { c1: "prev-a" }, 30, S);
    expect(s.voices).toEqual([{ clipIds: ["c1"], fileId: "prev-a", start: 3_200, end: 8_000, in: 30, speed: 1, gain: 1 }]);
    const [v] = s.voices;
    expect([sourceAt(s, v, 3_200, 44_100), sourceAt(s, v, 3_200, S), sourceAt(s, v, 3_201, S)]).toEqual([44_100, 48_000, 48_001]);
  });

  it("is sourceSeconds made continuous, at any speed", () => {
    const clip = video("c1", 2, 30, { in: 7, speed: 1.5 }) as MediaClip;
    const s = soundSchedule(doc([clip]), { c1: "f" }, 30, S);
    for (const frame of [2, 3, 17, 31]) {
      expect(sourceAt(s, s.voices[0], frame * 1_600, 44_100)).toBeCloseTo(44_100 * sourceSeconds(clip, frame, 30), 9);
    }
    expect(sourceAt(s, s.voices[0], 3_200 + S, S)).toBe(83_200); // 11,200 + 48,000 × 1.5
  });

  it("computes every position from sample numbers, so ten minutes in is as exact as the first sample", () => {
    const s = soundSchedule(doc([], [song("m1", 0, 18_000)]), { m1: "song" }, 30, S);
    expect(sourceAt(s, s.voices[0], 28_799_999, 44_100)).toBe((28_799_999 * 44_100) / 48_000);
  });

  it("rounds sample edges up at a frame rate that does not divide 48,000", () => {
    const s = soundSchedule(doc([video("c1", 1, 2)]), { c1: "f" }, 7, S);
    expect([s.voices[0].start, s.voices[0].end]).toEqual([6_858, 20_572]); // ceil(48,000 / 7), ceil(144,000 / 7)
  });

  it("reads a little of the file around each voice, more at higher speeds, never before 0", () => {
    expect(SOURCE_MARGIN_SECONDS).toBe(0.05);
    const at = (clip: Clip) => { const s = soundSchedule(doc([clip]), { c1: "f" }, 30, S); return voiceWindow(s, s.voices[0]); };
    const one = at(video("c1", 0, 60, { in: 30 }));
    expect([one.from, one.to].map((t) => +t.toFixed(9))).toEqual([0.95, 3.05]);
    expect(at(video("c1", 0, 60)).from).toBe(0);
    const fast = at(video("c1", 0, 30, { in: 30, speed: 2 }));
    expect([fast.from, fast.to].map((t) => +t.toFixed(9))).toEqual([0.9, 3.1]);
  });

  it("multiplies before it divides, for edges and for places in the file", () => {
    const s = soundSchedule(doc([video("c1", 31, 2)], [song("m1", 0, 30, { speed: 1.5 })]), { c1: "f", m1: "song" }, 30, S);
    expect([s.voices[0].start, s.voices[0].end]).toEqual([49_600, 52_800]); // (31 / 30) × 48,000 rounds up to 49,601
    expect(sourceAt(s, s.voices[1], 7, 44_100)).toBe((7 * 1.5 * 44_100) / 48_000);
  });

  it("keeps the margin at its least below speed 1", () => {
    const s = soundSchedule(doc([video("c1", 0, 60, { in: 30, speed: 0.5 })]), { c1: "f" }, 30, S);
    const { from, to } = voiceWindow(s, s.voices[0]);
    expect([from, to].map((t) => +t.toFixed(9))).toEqual([0.95, 2.05]);
  });

  it("makes the export longer for a sound past the last picture", () => {
    expect(frameCount(doc([], [song("m1", 0, 90)]))).toBe(90);
  });
});

describe("which clips sound", () => {
  it("follows the preview: a hidden video track is silent, a hidden audio track sounds, an invisible video sounds", () => {
    const d = doc([video("c1", 0, 30, { transform: { ...DEFAULT_TRANSFORM, opacity: 0 } })], [song("m1", 0, 30)]);
    d.tracks[3].hidden = true;
    expect(ids(d, { c1: "f1", m1: "f2" })).toEqual([["c1"], ["m1"]]);
    d.tracks[0].hidden = true;
    expect(ids(d, { c1: "f1", m1: "f2" })).toEqual([["m1"]]);
  });

  it("leaves out a clip with no file, a muted track, volume 0, a picture, and a speed that does not sound", () => {
    expect(ids(doc([video("c1", 0, 30)]), {})).toEqual([]);
    const muted = doc([], [song("m1", 0, 30)]);
    muted.tracks[3].muted = true;
    expect(ids(muted, { m1: "f" })).toEqual([]);
    const v1 = [video("c1", 0, 30, { volume: 0 }), video("i1", 30, 30, { type: "image" }), video("c3", 60, 30, { speed: 20 })];
    expect(ids(doc(v1), { c1: "f", i1: "f", c3: "f" })).toEqual([]);
  });

  it("plays at the shared gain, never above 1", () => {
    const s = soundSchedule(doc([], [song("m1", 0, 30, { volume: 1.5 }), song("m2", 60, 30, { volume: 0.25 })]), { m1: "f", m2: "f" }, 30, S);
    expect(s.voices.map((v) => v.gain)).toEqual([1, 0.25]);
  });
});

describe("seamless runs and file lifetimes", () => {
  it("merges a run of clips that continue one another into one voice", () => {
    const split = soundSchedule(doc([video("c1", 0, 30), video("c2", 30, 30, { in: 30 })]), { c1: "prev-a", c2: "prev-a" }, 30, S);
    expect(split.voices).toEqual([{ clipIds: ["c1", "c2"], fileId: "prev-a", start: 0, end: 96_000, in: 0, speed: 1, gain: 1 }]);
    const fast = [song("m1", 0, 30, { speed: 2 }), song("m2", 30, 30, { in: 60, speed: 2 }), song("m3", 60, 10, { in: 120, speed: 2 })];
    expect(ids(doc([], fast), { m1: "s", m2: "s", m3: "s" })).toEqual([["m1", "m2", "m3"]]);
  });

  it("keeps clips apart that do not continue one another", () => {
    const c1 = video("c1", 0, 30);
    for (const [why, c2, file] of [
      ["a gap", video("c2", 31, 30, { in: 31 }), "prev-a"],
      ["another in point", video("c2", 30, 30, { in: 31 }), "prev-a"],
      ["another volume", video("c2", 30, 30, { in: 30, volume: 0.5 }), "prev-a"],
      ["another speed", video("c2", 30, 30, { in: 30, speed: 2 }), "prev-a"],
      ["another file", video("c2", 30, 30, { in: 30 }), "prev-b"],
    ] as const) {
      expect(ids(doc([c1, c2]), { c1: "prev-a", c2: file }), why).toEqual([["c1"], ["c2"]]);
    }
    // split at frame 3 of a speed-1.5 clip: the second half starts at in round(4.5) = 4, not at 4.5
    expect(ids(doc([video("c1", 0, 3, { speed: 1.5 }), video("c2", 3, 7, { in: 4, speed: 1.5 })]), { c1: "f", c2: "f" })).toEqual([["c1"], ["c2"]]);
    // one file on two tracks
    expect(ids(doc([video("c1", 0, 30)], [song("m1", 30, 30, { in: 30 })]), { c1: "f", m1: "f" })).toEqual([["c1"], ["m1"]]);
  });

  it("keeps apart a clip after a gap even when its in point carries on", () => {
    expect(ids(doc([video("c1", 0, 30), video("c2", 31, 30, { in: 30 })]), { c1: "f", c2: "f" })).toEqual([["c1"], ["c2"]]);
  });

  it("says the last block each file is heard in", () => {
    const s = soundSchedule(doc([video("c1", 0, 45)], [song("m1", 0, 30)]), { c1: "prev-a", m1: "song" }, 30, S);
    expect(s.lastBlock).toEqual({ "prev-a": 1, song: 0 }); // 72,000 samples reach block 1; 48,000 end on block 0's edge
  });

  it("keeps a file to the last block of its latest voice, whatever the voices' order", () => {
    const s = soundSchedule(doc([video("c1", 0, 45)], [song("m1", 0, 30)]), { c1: "f", m1: "f" }, 30, S);
    expect(s.lastBlock).toEqual({ f: 1 });
  });
});
