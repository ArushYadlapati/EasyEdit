import { describe, expect, it } from "vitest";
import { ShotFacts, SheetPlan, SpeechFacts, VideoAnalysis } from "@/lib/style/types";
import { createColorMeter, cutList, sheetGrid, sheetTimes, shotFactsOf, shotStats, speechStats } from "@/lib/style/video-facts";
import type { CaptionWord } from "@/lib/timeline";

type Color = [number, number, number];
// A frame w by h, each pixel the colour given for it.
const frame = (w: number, h: number, color: (x: number, y: number) => Color) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set([...color(x, y), 255], (y * w + x) * 4);
  return out;
};
const flat = (c: Color, w = 8, h = 8) => frame(w, h, () => c);

// Words said one after another: each "text@start-end" in milliseconds.
const said = (...words: string[]): CaptionWord[] =>
  words.map((word) => {
    const [t, times] = word.split("@");
    const [s, e] = times.split("-").map(Number);
    return { t, s, e };
  });
// n words of 300 ms with 100 ms between them, from 0.
const steady = (n: number, text = (i: number) => `w${i}`): CaptionWord[] =>
  Array.from({ length: n }, (_, i) => ({ t: text(i), s: i * 400, e: i * 400 + 300 }));

describe("how a video is cut", () => {
  it("counts the shots between its cuts and how long they run", () => {
    const shots = shotStats([2, 4, 7], 10); // shots of 2, 2, 3 and 3 seconds
    expect(shots).toEqual({ count: 4, averageSeconds: 2.5, medianSeconds: 2.5, firstSeconds: 2, perMinute: 24 });
    expect(ShotFacts.parse(shots)).toEqual(shots);
  });

  it("takes cuts in any order, each once, and only inside the video", () => {
    expect(shotStats([7, 4, 4, -1, 0, 10, 12, Number.NaN, 2], 10)).toEqual(shotStats([2, 4, 7], 10));
  });

  it("is one long shot with no cuts, and nothing for a video with no length", () => {
    expect(shotStats([], 45)).toEqual({ count: 1, averageSeconds: 45, medianSeconds: 45, firstSeconds: 45, perMinute: 1.3 });
    expect(shotStats([1, 2], 0)).toEqual({ count: 0, averageSeconds: 0, medianSeconds: 0, firstSeconds: 0, perMinute: 0 });
  });

  it("gives seconds to 0.1, and never a shot longer than the video", () => {
    expect(shotStats([0.33, 0.66], 1)).toEqual({ count: 3, averageSeconds: 0.3, medianSeconds: 0.3, firstSeconds: 0.3, perMinute: 180 });
    // 0.25 s rounds up to 0.3, past the end of the video, so it is kept at the video's length.
    expect(shotStats([], 0.25)).toMatchObject({ averageSeconds: 0.25, medianSeconds: 0.25, firstSeconds: 0.25 });
  });

  it("keeps a cut list the facts can hold: inside the video, to two places, in order, each once", () => {
    expect(cutList([7.123, 2.004, 2.001, 0, -1, 10, 12, Number.NaN, 4.5, 9.996], 10)).toEqual([2, 4.5, 7.12]);
    expect(cutList([1, 2], 0)).toEqual([]);
    // 0.1 + 0.2 isn't 0.3 in a computer; rounded, it is, and it is still two places.
    const cuts = cutList([0.1 + 0.2, 1 / 3], 1);
    expect(cuts).toEqual([0.3, 0.33]);
    const video = {
      kind: "video",
      seconds: 1,
      width: 1080,
      height: 1920,
      shots: shotStats(cuts, 1),
      cuts,
      speech: null,
      sound: null,
      color: { brightness: 0.5, saturation: 0.5, warmth: 0 },
      sheet: null,
      analyzedAt: "2026-11-25T21:00:00.000Z",
    };
    expect(VideoAnalysis.safeParse(video).success).toBe(true);
  });

  it("keeps at most 400 cuts, picked evenly through the video", () => {
    const many = Array.from({ length: 1000 }, (_, i) => (i + 1) * 0.1); // a cut every 0.1 s of a 100.1 s video
    const cuts = cutList(many, 100.1);
    expect(cuts).toHaveLength(400);
    expect(cuts.every((t, i) => i === 0 || t > cuts[i - 1])).toBe(true);
    expect(cuts[0]).toBeLessThan(1);
    expect(cuts[399]).toBeGreaterThan(99);
  });

  it("works from shot lengths too, leaving out empty ones", () => {
    expect(shotFactsOf([2, 0, 3, -1, 3], 8)).toEqual({ count: 3, averageSeconds: 2.7, medianSeconds: 3, firstSeconds: 2, perMinute: 22.5 });
    expect(shotFactsOf([], 8).count).toBe(0);
  });
});

describe("a video's colours", () => {
  it("reads brightness, saturation and warmth from a frame", () => {
    const measure = (c: Color) => {
      const meter = createColorMeter();
      meter.add(flat(c), 8, 8);
      return meter.result();
    };
    expect(measure([255, 255, 255])).toEqual({ brightness: 1, saturation: 0, warmth: 0 });
    expect(measure([0, 0, 0])).toEqual({ brightness: 0, saturation: 0, warmth: 0 });
    expect(measure([255, 0, 0])).toEqual({ brightness: 0.3, saturation: 1, warmth: 1 });
    expect(measure([0, 0, 255])).toEqual({ brightness: 0.11, saturation: 1, warmth: -1 });
    expect(measure([255, 128, 0])).toMatchObject({ saturation: 1, warmth: 1 });
    expect(measure([128, 128, 128]).saturation).toBe(0);
  });

  it("counts each frame the same, however big it is", () => {
    const meter = createColorMeter();
    meter.add(flat([255, 255, 255], 2, 2), 2, 2);
    meter.add(flat([0, 0, 0], 64, 64), 64, 64);
    expect(meter.frames()).toBe(2);
    expect(meter.result().brightness).toBe(0.5);
  });

  it("looks at enough of a big frame to see both halves", () => {
    const meter = createColorMeter();
    meter.add(frame(640, 360, (x) => (x < 320 ? [255, 0, 0] : [0, 0, 255])), 640, 360);
    const color = meter.result();
    expect(color.saturation).toBe(1);
    expect(Math.abs(color.warmth)).toBeLessThan(0.05);
  });

  it("is all 0 with no frames, and passes over a frame with no pixels or too few bytes", () => {
    const meter = createColorMeter();
    expect(meter.result()).toEqual({ brightness: 0, saturation: 0, warmth: 0 });
    meter.add(new Uint8ClampedArray(0), 0, 0);
    meter.add(new Uint8ClampedArray(0), 8, 8);
    expect(meter.frames()).toBe(0);
    meter.add(flat([255, 255, 255], 2, 2), Number.NaN, 2);
    expect(meter.frames()).toBe(0);
    meter.add(flat([255, 255, 255], 2, 2), 8, 8); // says 8 by 8 but holds 2 by 2
    expect(meter.result().brightness).toBe(1);
  });
});

describe("what is said", () => {
  it("is nothing with fewer than three words", () => {
    expect(speechStats([], 10)).toBeNull();
    expect(speechStats(said("Hi@0-200", "there@300-500"), 10)).toBeNull();
  });

  it("counts the words, how fast they come, and the first sentence", () => {
    const words = said("Hey@0-300", "everyone.@400-900", "Today@1500-1800", "we@1900-2000", "cook@2100-2400", "pasta!@2500-3000");
    const speech = speechStats(words, 10)!;
    expect(speech).toMatchObject({ words: 6, perMinute: 36, opening: "Hey everyone." });
    expect(SpeechFacts.parse(speech)).toEqual(speech);
  });

  it("opens with at most 30 words when no sentence ends sooner, and no more than can be kept", () => {
    expect(speechStats(steady(40), 20)!.opening.split(" ")).toHaveLength(30);
    expect(speechStats(steady(40), 20)!.opening).toMatch(/^w0 w1 w2 .* w29$/);
    const long = speechStats(steady(30, () => "x".repeat(40)), 20)!;
    expect(long.opening.length).toBeLessThanOrEqual(300);
    expect(long.opening.split(" ")).toHaveLength(7); // 7 × 40 + 6 spaces = 286; an 8th would be 327
    expect(SpeechFacts.safeParse(long).success).toBe(true);
  });

  it("joins words across pauses under 0.6 s to find how much of the video has talking", () => {
    // 0–0.4 s and 0.7–1 s are one stretch (a 0.3 s pause); 2–2.5 s is another after a 1 s pause: 1.5 s of 10.
    expect(speechStats(said("a@0-400", "b@700-1000", "c@2000-2500"), 10)!.talkingShare).toBe(0.15);
    // A word that sits inside the one before doesn't count twice.
    expect(speechStats(said("a@0-1000", "b@200-400", "c@1100-2000"), 4)!.talkingShare).toBe(0.5);
  });

  it("counts a word with a space in it as two, as the facts do", () => {
    const words = Array.from({ length: 30 }, (_, i) => ({ t: `New York${i}`, s: i * 400, e: i * 400 + 300 }));
    const speech = speechStats(words, 20)!;
    expect(speech.opening.split(" ")).toHaveLength(30);
    expect(speech.opening).toMatch(/^New York0 New York1 .* New York14$/);
    expect(SpeechFacts.safeParse(speech).success).toBe(true);
  });

  it("puts the words in time order first, and never counts more talking than the video", () => {
    const shuffled = said("third@800-1000", "first@0-300", "second@400-700");
    expect(speechStats(shuffled, 10)!.opening).toBe("first second third");
    expect(speechStats(said("a@0-4000", "b@4000-8000", "c@8000-12000"), 10)!.talkingShare).toBe(1);
  });

  it("gives no rate or share for a video with no length", () => {
    expect(speechStats(steady(5), 0)).toMatchObject({ words: 5, perMinute: 0, talkingShare: 0 });
  });
});

describe("when the strip's frames are taken", () => {
  const sorted = (times: number[]) => times.every((t, i) => i === 0 || t > times[i - 1]);

  it("starts 0.2 s in, or in the middle of a very short video", () => {
    expect(sheetTimes([], 30, 1)).toEqual([0.2]);
    expect(sheetTimes([], 0.3, 1)).toEqual([0.15]);
    expect(sheetTimes([], 0)).toEqual([0]);
    // A frame of the rest that comes too close to the first is the one left out.
    const short = sheetTimes([], 0.3);
    expect(short).toContain(0.15);
    expect(short.every((t) => t === 0.15 || Math.abs(t - 0.15) >= 0.05 - 1e-9)).toBe(true);
  });

  it("spreads the rest over one long shot, the first frame standing for its first part", () => {
    // 12 parts of 5 s: the first frame in place of the first part's middle, then the middles of the other 11.
    expect(sheetTimes([], 60)).toEqual([0.2, 7.5, 12.5, 17.5, 22.5, 27.5, 32.5, 37.5, 42.5, 47.5, 52.5, 57.5]);
  });

  it("never spends two frames on the first moment of a short single shot", () => {
    // Before, a 9 s clip gave 0.2 s and 0.41 s, which show all but the same picture.
    const times = sheetTimes([], 9);
    expect(times).toHaveLength(12);
    expect(times.slice(0, 3)).toEqual([0.2, 1.13, 1.88]);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.74);
  });

  it("picks the shots after the first evenly through a video with more of them than room", () => {
    const cuts = Array.from({ length: 23 }, (_, i) => i + 1); // 24 shots of 1 second
    expect(sheetTimes(cuts, 24)).toEqual([0.2, 2.5, 4.5, 6.5, 8.5, 10.5, 12.5, 14.5, 16.5, 18.5, 20.5, 22.5]);
    // 12 shots: the first frame for the first, and one from the middle of each of the other 11.
    expect(sheetTimes(Array.from({ length: 11 }, (_, i) => i + 1), 12)).toEqual([0.2, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]);
  });

  it("gives longer shots more frames when there are fewer shots than room, counting the first frame as the first shot's", () => {
    // A 2 s shot and a 10 s shot, 5 frames: the first frame is the short shot's, and the long one gets 4, from the
    // middles of its quarters.
    expect(sheetTimes([2], 12, 5)).toEqual([0.2, 3.25, 5.75, 8.25, 10.75]);
    // Cuts at 2.5, 4.5 and 7.5 s in 9 s: the first shot's other frames are from the middles of its later parts.
    expect(sheetTimes([2.5, 4.5, 7.5], 9).slice(0, 3)).toEqual([0.2, 1.25, 2.08]);
  });

  it("never takes more frames than a strip holds", () => {
    expect(sheetTimes([], 60, 40)).toHaveLength(12);
    expect(sheetTimes([], 60, Number.NaN)).toHaveLength(12);
    expect(sheetTimes([], 60, 0)).toEqual([0.2]);
  });

  it("keeps frames at least 0.05 s apart, in order, inside the video and within the most asked for", () => {
    for (const [cuts, seconds, max] of [
      [[0.1, 0.2, 0.3], 1, 12],
      [[0.02, 0.04, 0.06, 0.08], 0.1, 12],
      [Array.from({ length: 300 }, (_, i) => (i + 1) * 0.5), 151, 12],
      [[5, 10], 15, 3],
    ] as const) {
      const times = sheetTimes(cuts, seconds, max);
      expect(times.length).toBeGreaterThan(0);
      expect(times.length).toBeLessThanOrEqual(max);
      expect(sorted(times)).toBe(true);
      expect(times.every((t, i) => i === 0 || t - times[i - 1] >= 0.05 - 1e-9)).toBe(true);
      expect(times.every((t) => t >= 0 && t <= seconds)).toBe(true);
    }
  });

  it("fits a grid the strip checks against", () => {
    for (const times of [sheetTimes([], 60), sheetTimes([2], 12, 5), sheetTimes([], 0.3)]) {
      for (const [w, h] of [
        [1080, 1920],
        [1920, 1080],
      ]) {
        const grid = sheetGrid(times.length, w, h);
        expect(SheetPlan.safeParse({ times, columns: grid.columns, rows: grid.rows }).success).toBe(true);
      }
    }
  });
});

describe("the strip's grid", () => {
  it("has 4 columns of tall tiles for a tall video and 3 of wide tiles for a wide one", () => {
    expect(sheetGrid(12, 1080, 1920)).toEqual({ columns: 4, rows: 3, tileW: 135, tileH: 240, width: 540, height: 720 });
    expect(sheetGrid(12, 1920, 1080)).toEqual({ columns: 3, rows: 4, tileW: 240, tileH: 135, width: 720, height: 540 });
    expect(sheetGrid(12, 1080, 1080)).toMatchObject({ columns: 3, rows: 4, tileW: 240, tileH: 240 });
  });

  it("has fewer columns for a few frames, and as many rows as they need", () => {
    expect(sheetGrid(2, 1080, 1920)).toMatchObject({ columns: 2, rows: 1, width: 270 });
    expect(sheetGrid(5, 1080, 1920)).toMatchObject({ columns: 4, rows: 2 });
    expect(sheetGrid(1, 1920, 1080)).toMatchObject({ columns: 1, rows: 1, width: 240, height: 135 });
    expect(sheetGrid(0, 1920, 1080)).toMatchObject({ columns: 1, rows: 1 });
  });

  it("takes another tile size, and a video with no size as square", () => {
    expect(sheetGrid(4, 1080, 1350, 120)).toEqual({ columns: 4, rows: 1, tileW: 96, tileH: 120, width: 384, height: 120 });
    expect(sheetGrid(3, 0, 0)).toMatchObject({ tileW: 240, tileH: 240 });
    expect(sheetGrid(3, Number.NaN, Number.POSITIVE_INFINITY, Number.NaN)).toMatchObject({ tileW: 240, tileH: 240, width: 720 });
  });
});
