import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaServices } from "@/components/editor/media/media-context";
import {
  AnalyzeError,
  SOUND_MAX_SECONDS,
  analyzeVideo,
  browserAnalyzeDeps,
  failureReason,
  filesToTry,
  sheetLabel,
  sheetLabels,
  type AnalyzeDeps,
  type AnalyzeProgress,
  type SheetCanvas,
} from "@/components/style/analyze-video";
import { SPEECH_MODEL, TranscribeError } from "@/lib/captions/speech/client";
import { LIMITS } from "@/lib/limits";
import { localFileId } from "@/lib/media/types";
import { STYLE_WORDS } from "@/lib/style/messages";
import { ANALYSIS_LIMITS, VideoAnalysis } from "@/lib/style/types";
import { sheetTimes, speechStats } from "@/lib/style/video-facts";
import type { CaptionWord } from "@/lib/timeline";
import { assetView } from "../helpers/media-services";

type Color = [number, number, number];
const RED: Color = [200, 30, 30];
const BLUE: Color = [30, 30, 200];
const GREEN: Color = [30, 200, 30];

// A made-up file: its shots, each [seconds, colour], shown at 30 frames a second; or no picture at all.
type Footage = { shots: [number, Color][] } | { noPicture: true };
const FPS = 30;
const flat = (color: Color) => new Uint8ClampedArray(8 * 8 * 4).map((_, b) => (b % 4 === 3 ? 255 : color[b % 4]));

// 6 seconds: 2 s red, 1.5 s blue, 2.5 s green, so it cuts at 2 s and 3.5 s.
const THREE_SHOTS: Footage = { shots: [[2, RED], [1.5, BLUE], [2.5, GREEN]] };

// Twelve words said one after another from the start, 300 ms each with 100 ms between them.
const WORDS: CaptionWord[] = Array.from({ length: 12 }, (_, i) => ({ t: i === 11 ? "end." : `word${i}`, s: i * 400, e: i * 400 + 300 }));

// A JPEG-looking blob of this many bytes.
const jpeg = (bytes: number) => {
  const data = new Uint8Array(bytes);
  data.set([0xff, 0xd8, 0xff, 0xe0]);
  return new Blob([data], { type: "image/jpeg" });
};

// What one fake canvas was asked to do.
type Drawn = { width: number; height: number; ops: unknown[][]; asked: { type: string; quality: number }[] };

type Setup = {
  files?: Record<string, Footage>; // file id → what it shows; a file not listed can't be read
  sound?: Record<string, Float32Array | null>; // file id → its one side of sound at 1000 a second; null: can't be decoded
  decodeFails?: (seconds: number) => boolean;
  sheetBytes?: (canvas: Drawn, quality: number) => number;
  onFrame?: (seconds: number) => void;
};

// Fake deps: files read by id, frames played from their footage, a canvas that records what it draws, and speech that
// answers WORDS. Every call is recorded.
function fakeDeps(setup: Setup = {}) {
  const footage = setup.files ?? { "prev-a": THREE_SHOTS, "orig-a": THREE_SHOTS };
  const blobs = new Map<string, Blob>(Object.keys(footage).map((id) => [id, new Blob([id])]));
  const idOf = (blob: Blob) => [...blobs].find(([, b]) => b === blob)?.[0] ?? "?";
  const canvases: Drawn[] = [];
  const scanned: { file: string; from: number; to: number; side: number }[] = [];
  const decoded: { file: string; seconds: number; size: number }[] = [];
  const transcribed: string[] = [];
  const steady = new Float32Array(2000).fill(0.1);

  const deps = {
    files: {
      get: vi.fn(async (id: string) => {
        const blob = blobs.get(id);
        return blob ? { ok: true as const, blob } : { ok: false as const, problem: "missing" as const };
      }),
      put: async () => {},
    },
    scanFrames: vi.fn(async (blob: Blob, from: number, to: number, side: number, each: (s: number, rgba: Uint8ClampedArray, w: number, h: number) => boolean | void) => {
      const file = idOf(blob);
      scanned.push({ file, from, to, side });
      const shown = footage[file];
      if (!shown || "noPicture" in shown) return false;
      let at = 0;
      for (const [seconds, color] of shown.shots) {
        for (let i = 0; i < Math.round(seconds * FPS); i++, at++) {
          const moment = at / FPS;
          if (moment < from || moment >= to) continue;
          setup.onFrame?.(moment);
          if (each(moment, flat(color), 8, 8) === false) return true;
        }
      }
      return true;
    }),
    decodeVideoFrame: vi.fn(async (blob: Blob, seconds: number, size: number) => {
      decoded.push({ file: idOf(blob), seconds, size });
      if (setup.decodeFails?.(seconds)) return null;
      return { image: { at: seconds } as unknown as CanvasImageSource, width: 135, height: 240 };
    }),
    decodeSound: vi.fn(async (blob: Blob) => {
      const side = setup.sound ? setup.sound[idOf(blob)] : steady;
      return side ? { ok: true as const, sound: { sides: [side], sampleRate: 1000 } } : { ok: false as const, why: "unreadable" as const };
    }),
    // Reports in the order the speech worker does: the sound read, the model fetched, then the words heard.
    transcribe: vi.fn(async (blob: Blob, opts: Parameters<AnalyzeDeps["transcribe"]>[1]): Promise<CaptionWord[]> => {
      transcribed.push(idOf(blob));
      opts.onProgress?.({ stage: "sound", done: 0, total: 6 });
      opts.onProgress?.({ stage: "sound", done: 6, total: 6 });
      opts.onProgress?.({ stage: "model", done: 50, total: 100 });
      opts.onProgress?.({ stage: "model", done: 100, total: 100 });
      opts.onProgress?.({ stage: "speech", done: 3, total: 6 });
      opts.onProgress?.({ stage: "speech", done: 6, total: 6 });
      return WORDS;
    }),
    fetchSavedTranscript: vi.fn(async (): Promise<CaptionWord[] | null> => null),
    saveTranscript: vi.fn(async () => true),
    makeCanvas: vi.fn((width: number, height: number): SheetCanvas => {
      const drawn: Drawn = { width, height, ops: [], asked: [] };
      canvases.push(drawn);
      const ctx = {
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillRect: (...args: number[]) => drawn.ops.push(["fillRect", ...args, ctx.fillStyle]),
        drawImage: (image: CanvasImageSource, ...args: number[]) => drawn.ops.push(["drawImage", (image as unknown as { at: number }).at, ...args]),
        fillText: (text: string, x: number, y: number) => drawn.ops.push(["fillText", text, x, y, ctx.fillStyle, ctx.font]),
        measureText: (text: string) => ({ width: text.length * 6 }),
        beginPath: () => {},
        roundRect: (...args: number[]) => drawn.ops.push(["roundRect", ...args]),
        fill: () => drawn.ops.push(["fill", ctx.fillStyle]),
      };
      return {
        getContext: () => ctx,
        toBlob: async (type, quality) => {
          drawn.asked.push({ type, quality });
          return jpeg(setup.sheetBytes?.(drawn, quality) ?? 20_000);
        },
      };
    }),
    now: () => new Date("2026-11-25T10:00:00.000Z"),
  } satisfies AnalyzeDeps;
  return { deps, canvases, scanned, decoded, transcribed };
}

// A ready portrait video of 6 seconds with sound, playing from its preview copy.
const VIDEO = assetView({ durationMs: 6000, width: 1080, height: 1920 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looking over a video", () => {
  it("finds its cuts in one pass over small frames, and its shots, colours and size", async () => {
    const { deps, scanned } = fakeDeps();
    const { analysis } = await analyzeVideo(VIDEO, deps);
    expect(scanned).toEqual([{ file: "prev-a", from: 0, to: 6, side: 64 }]);
    expect(analysis.cuts).toEqual([2, 3.5]);
    expect(analysis.shots).toEqual({ count: 3, averageSeconds: 2, medianSeconds: 2, firstSeconds: 2, perMinute: 30 });
    expect(analysis).toMatchObject({ kind: "video", seconds: 6, width: 1080, height: 1920, analyzedAt: "2026-11-25T10:00:00.000Z" });
    // Every colour has the same saturation; red and green outweigh blue, so it is a little warm.
    expect(analysis.color.saturation).toBe(0.85);
    expect(analysis.color.warmth).toBeGreaterThan(0);
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("measures the sound and hears the words, then saves them for Auto captions", async () => {
    const { deps, transcribed } = fakeDeps();
    const { analysis } = await analyzeVideo(VIDEO, deps);
    expect(analysis.sound).toEqual({ loudnessDb: -20, peakDb: -20 });
    expect(deps.fetchSavedTranscript).toHaveBeenCalledWith("a");
    expect(transcribed).toEqual(["prev-a"]);
    expect(deps.saveTranscript).toHaveBeenCalledWith("a", WORDS);
    expect(analysis.speech).toEqual(speechStats(WORDS, 6));
    expect(analysis.speech?.opening.split(" ")).toHaveLength(12);
    expect(analysis).not.toHaveProperty("speechSkipped");
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("uses words saved before and doesn't hear the video again", async () => {
    const { deps } = fakeDeps();
    deps.fetchSavedTranscript.mockResolvedValue(WORDS);
    const { analysis } = await analyzeVideo(VIDEO, deps);
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.saveTranscript).not.toHaveBeenCalled();
    expect(analysis.speech).toEqual(speechStats(WORDS, 6));
  });

  it("keeps everything else when hearing the words goes wrong", async () => {
    const { deps } = fakeDeps();
    deps.fetchSavedTranscript.mockRejectedValue(new Error("offline"));
    deps.transcribe.mockRejectedValue(new TranscribeError("model", "The model couldn't be loaded."));
    const { analysis, sheet } = await analyzeVideo(VIDEO, deps);
    expect(deps.transcribe).toHaveBeenCalledOnce();
    expect(analysis.speech).toBeNull();
    // Not heard is not silent: agents are told the words weren't measured, not that nobody talks.
    expect(analysis.speechSkipped).toBe("failed");
    expect(analysis.sound).not.toBeNull();
    expect(sheet).not.toBeNull();
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("hears the original when the preview copy has no sound it can read, as Auto captions does", async () => {
    const { deps, transcribed } = fakeDeps();
    deps.transcribe.mockImplementation(async (blob: Blob) => {
      transcribed.push(await blob.text());
      if ((await blob.text()) === "prev-a") throw new TranscribeError("no-sound", "No sound.");
      return WORDS;
    });
    const { analysis } = await analyzeVideo(VIDEO, deps);
    expect(transcribed).toEqual(["prev-a", "orig-a"]);
    expect(analysis.speech).toEqual(speechStats(WORDS, 6));
    // The picture still came from the preview.
    expect(deps.scanFrames).toHaveBeenCalledOnce();
  });

  it("finds no words in a video nobody talks in, and saves none", async () => {
    const { deps } = fakeDeps();
    deps.transcribe.mockResolvedValue([]);
    const { analysis } = await analyzeVideo(VIDEO, deps);
    expect(analysis.speech).toBeNull();
    // It was heard, and nobody talks: nothing was skipped.
    expect(analysis).not.toHaveProperty("speechSkipped");
    expect(deps.saveTranscript).not.toHaveBeenCalled();
  });

  it("says why the words weren't heard when no file has sound to hear, or none can be read", async () => {
    const silent = fakeDeps();
    silent.deps.transcribe.mockRejectedValue(new TranscribeError("no-sound", "No sound."));
    const none = await analyzeVideo(VIDEO, silent.deps);
    expect(silent.deps.transcribe).toHaveBeenCalledTimes(2); // the preview, then the original
    expect(none.analysis).toMatchObject({ speech: null, speechSkipped: "no-audio" });

    const garbled = fakeDeps();
    garbled.deps.transcribe.mockRejectedValueOnce(new TranscribeError("no-sound", "No sound.")).mockRejectedValueOnce(new TranscribeError("undecodable", "Can't decode."));
    expect((await analyzeVideo(VIDEO, garbled.deps)).analysis).toMatchObject({ speech: null, speechSkipped: "failed" });

    const refused = fakeDeps();
    refused.deps.transcribe.mockRejectedValue(new TranscribeError("too-long", "Too long."));
    const long = await analyzeVideo(VIDEO, refused.deps);
    expect(long.analysis).toMatchObject({ speech: null, speechSkipped: "too-long" });
    expect(VideoAnalysis.parse(long.analysis)).toEqual(long.analysis);

    // Why words weren't heard is kept only beside no words.
    const talking = (await analyzeVideo(VIDEO, fakeDeps().deps)).analysis;
    expect(VideoAnalysis.safeParse({ ...talking, speechSkipped: "failed" }).success).toBe(false);
  });

  it("doesn't listen when asked not to, or to a video with no sound", async () => {
    const quiet = fakeDeps();
    const { analysis } = await analyzeVideo(VIDEO, quiet.deps, { listen: false });
    expect(quiet.deps.fetchSavedTranscript).not.toHaveBeenCalled();
    expect(quiet.deps.transcribe).not.toHaveBeenCalled();
    expect(analysis.speech).toBeNull();
    expect(analysis.speechSkipped).toBe("off");
    expect(analysis.sound).not.toBeNull();

    const silent = fakeDeps();
    const mute = await analyzeVideo(assetView({ ...VIDEO, hasAudio: false }), silent.deps);
    expect(silent.deps.decodeSound).not.toHaveBeenCalled();
    expect(silent.deps.transcribe).not.toHaveBeenCalled();
    expect(mute.analysis).toMatchObject({ speech: null, speechSkipped: "no-audio", sound: null });
    expect(VideoAnalysis.parse(mute.analysis)).toEqual(mute.analysis);
  });

  it("has no sound facts for silence, or for sound that can't be decoded", async () => {
    const hush = fakeDeps({ sound: { "prev-a": new Float32Array(2000), "orig-a": new Float32Array(2000) } });
    expect((await analyzeVideo(VIDEO, hush.deps, { listen: false })).analysis.sound).toBeNull();
    const broken = fakeDeps({ sound: { "prev-a": null, "orig-a": null } });
    expect((await analyzeVideo(VIDEO, broken.deps, { listen: false })).analysis.sound).toBeNull();
    // The original is tried when the preview's sound can't be decoded.
    const fallback = fakeDeps({ sound: { "prev-a": null, "orig-a": new Float32Array(2000).fill(0.5) } });
    const { analysis } = await analyzeVideo(VIDEO, fallback.deps, { listen: false });
    expect(analysis.sound).toEqual({ loudnessDb: -6, peakDb: -6 });
  });

  it("tells how far reading the frames has got against the file's own length when the library doesn't know it", async () => {
    const shotsDone = (seen: AnalyzeProgress[]) => seen.filter((p) => p.stage === "shots" && p.done > 0 && p.done < 0.9).length;
    const known = fakeDeps();
    const withLength: AnalyzeProgress[] = [];
    await analyzeVideo(VIDEO, known.deps, { listen: false, onProgress: (p) => withLength.push(p) });

    const told = fakeDeps();
    const videoSeconds = vi.fn(async () => 6);
    const fromFile: AnalyzeProgress[] = [];
    const { analysis } = await analyzeVideo(assetView({ ...VIDEO, durationMs: null }), { ...told.deps, videoSeconds }, { listen: false, onProgress: (p) => fromFile.push(p) });
    expect(videoSeconds).toHaveBeenCalledOnce();
    expect(shotsDone(fromFile)).toBe(shotsDone(withLength));
    expect(shotsDone(fromFile)).toBeGreaterThan(50);
    expect(analysis.seconds).toBe(6); // still from the last frame read

    // A file that can't say either: no share is told until the frames are read, as before.
    const silent = fakeDeps();
    const unknown: AnalyzeProgress[] = [];
    await analyzeVideo(assetView({ ...VIDEO, durationMs: null }), { ...silent.deps, videoSeconds: async () => null }, { listen: false, onProgress: (p) => unknown.push(p) });
    expect(shotsDone(unknown)).toBe(0);
  });

  it("takes its length from the last frame when the library doesn't know it", async () => {
    const { deps, scanned } = fakeDeps();
    const { analysis } = await analyzeVideo(assetView({ ...VIDEO, durationMs: null }), deps);
    expect(scanned[0].to).toBe(ANALYSIS_LIMITS.seconds + 1);
    expect(analysis.seconds).toBe(6);
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("reads a video of unknown length no further than just past the longest it looks at, then says it's too long", async () => {
    const { deps } = fakeDeps();
    const seen: number[] = [];
    deps.scanFrames.mockImplementation(async (_blob, _from, to, _side, each) => {
      for (const t of [0, 1, ANALYSIS_LIMITS.seconds + 0.5, ANALYSIS_LIMITS.seconds + 2]) {
        if (t >= to) break;
        seen.push(t);
        each(t, flat(RED), 8, 8);
      }
      return true;
    });
    const error = await analyzeVideo(assetView({ ...VIDEO, durationMs: null }), deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalyzeError);
    expect((error as AnalyzeError).code).toBe("tooLong");
    expect(seen).toEqual([0, 1, ANALYSIS_LIMITS.seconds + 0.5]);
    expect(deps.decodeVideoFrame).not.toHaveBeenCalled();
  });

  it("doesn't hear a video longer than Auto captions would, but still uses words saved for it", async () => {
    const long = assetView({ ...VIDEO, durationMs: (LIMITS.captionAudioMinutes * 60 + 1) * 1000 });
    const { deps } = fakeDeps();
    const { analysis } = await analyzeVideo(long, deps);
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(analysis.speech).toBeNull();
    expect(analysis.speechSkipped).toBe("too-long");

    const saved = fakeDeps();
    saved.deps.fetchSavedTranscript.mockResolvedValue(WORDS);
    const heard = (await analyzeVideo(long, saved.deps)).analysis;
    expect(heard.speech).toEqual(speechStats(WORDS, long.durationMs! / 1000));
    expect(heard).not.toHaveProperty("speechSkipped");
  });

  it("measures the sound of a video up to an hour long, and not of a longer one, whose sound would be held in memory whole", async () => {
    expect(SOUND_MAX_SECONDS).toBe(60 * 60);
    const hour = fakeDeps();
    const { analysis: measured } = await analyzeVideo(assetView({ ...VIDEO, durationMs: SOUND_MAX_SECONDS * 1000 }), hour.deps);
    expect(hour.deps.decodeSound).toHaveBeenCalledOnce();
    expect(measured.sound).toEqual({ loudnessDb: -20, peakDb: -20 });

    const longer = fakeDeps();
    longer.deps.fetchSavedTranscript.mockResolvedValue(WORDS);
    const { analysis } = await analyzeVideo(assetView({ ...VIDEO, durationMs: (SOUND_MAX_SECONDS + 1) * 1000 }), longer.deps);
    expect(longer.deps.decodeSound).not.toHaveBeenCalled();
    expect(analysis.sound).toBeNull();
    // Everything else is still measured.
    expect(analysis.speech).toEqual(speechStats(WORDS, SOUND_MAX_SECONDS + 1));
    expect(analysis.shots.count).toBe(3);
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("reports each step from 0 to 1, in order", async () => {
    const { deps } = fakeDeps();
    const seen: AnalyzeProgress[] = [];
    await analyzeVideo(VIDEO, deps, { onProgress: (p) => seen.push(p) });
    const stages = seen.map((p) => p.stage).filter((stage, i, all) => stage !== all[i - 1]);
    expect(stages).toEqual(["shots", "listening"]);
    for (const stage of ["shots", "listening"] as const) {
      const done = seen.filter((p) => p.stage === stage).map((p) => p.done);
      expect(done[0]).toBe(0);
      expect(done.at(-1)).toBe(1);
      expect(done).toEqual([...done].sort((a, b) => a - b));
      expect(new Set(done).size).toBe(done.length); // the same place is never reported twice
    }
    expect(seen).toContainEqual({ stage: "listening", done: 0.1 }); // the sound read
    expect(seen).toContainEqual({ stage: "listening", done: 0.2 }); // half the model fetched
    expect(seen).toContainEqual({ stage: "listening", done: 0.65 }); // half the words heard
  });

  it("never goes back when the original is heard after the preview", async () => {
    const { deps } = fakeDeps();
    deps.transcribe.mockImplementation(async (blob: Blob, opts) => {
      opts.onProgress?.({ stage: "sound", done: 6, total: 6 });
      opts.onProgress?.({ stage: "model", done: 100, total: 100 });
      if ((await blob.text()) === "prev-a") throw new TranscribeError("undecodable", "Garbled.");
      return WORDS;
    });
    const seen: number[] = [];
    await analyzeVideo(VIDEO, deps, { onProgress: (p) => p.stage === "listening" && seen.push(p.done) });
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(1);
  });
});

describe("the strip of frames", () => {
  it("decodes a frame from the middle of the shots and draws them on a grid, each with its moment", async () => {
    const { deps, canvases, decoded } = fakeDeps();
    const { analysis, sheet } = await analyzeVideo(VIDEO, deps);
    const times = sheetTimes([2, 3.5], 6);
    expect(times).toHaveLength(12);
    expect(decoded).toEqual(times.map((seconds) => ({ file: "prev-a", seconds, size: 240 })));
    // A tall video: 4 columns of 135 × 240 tiles.
    expect(analysis.sheet).toEqual({ times, columns: 4, rows: 3 });
    expect(canvases).toHaveLength(1);
    const [canvas] = canvases;
    expect(canvas).toMatchObject({ width: 540, height: 720, asked: [{ type: "image/jpeg", quality: 0.8 }] });
    const draws = canvas.ops.filter((op) => op[0] === "drawImage");
    expect(draws).toHaveLength(12);
    expect(draws.slice(0, 2)).toEqual([
      ["drawImage", times[0], 0, 0, 135, 240],
      ["drawImage", times[1], 135, 0, 135, 240],
    ]);
    expect(draws[4]).toEqual(["drawImage", times[4], 0, 240, 135, 240]);
    // Each label is white text on a dark, see-through pill in the tile's corner.
    const labels = canvas.ops.filter((op) => op[0] === "fillText");
    expect(labels.map((op) => op[1])).toEqual(sheetLabels(times));
    expect(labels[0]).toEqual(["fillText", "0:00.2", 9, 13, "#fff", expect.stringContaining("12px")]);
    expect(canvas.ops).toContainEqual(["fill", "rgba(0, 0, 0, 0.6)"]);
    expect(canvas.ops.find((op) => op[0] === "roundRect")).toEqual(["roundRect", 4, 4, 46, 18, 9]);

    const bytes = new Uint8Array(await sheet!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("lays a wide video out in 3 columns", async () => {
    const { deps, canvases } = fakeDeps();
    const { analysis } = await analyzeVideo(assetView({ ...VIDEO, width: 1920, height: 1080 }), deps);
    expect(analysis.sheet).toMatchObject({ columns: 3, rows: 4 });
    expect(canvases[0]).toMatchObject({ width: 720, height: 540 });
  });

  it("leaves out frames that can't be decoded", async () => {
    const times = sheetTimes([2, 3.5], 6);
    const { deps } = fakeDeps({ decodeFails: (t) => t === times[1] || t === times[2] });
    const { analysis } = await analyzeVideo(VIDEO, deps);
    expect(analysis.sheet).toEqual({ times: times.filter((_, i) => i !== 1 && i !== 2), columns: 4, rows: 3 });
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("frees every frame it decoded once the strip is drawn, or when it is stopped part way", async () => {
    const closed: number[] = [];
    const closable = (deps: AnalyzeDeps & { decodeVideoFrame: ReturnType<typeof vi.fn> }, onDecode?: (t: number) => void) =>
      deps.decodeVideoFrame.mockImplementation(async (_blob: Blob, seconds: number) => {
        onDecode?.(seconds);
        const image = { at: seconds, close: () => closed.push(seconds) } as unknown as CanvasImageSource;
        return { image, width: 135, height: 240 };
      });

    const whole = fakeDeps();
    closable(whole.deps);
    await analyzeVideo(VIDEO, whole.deps);
    expect(closed.sort((a, b) => a - b)).toEqual(sheetTimes([2, 3.5], 6));

    closed.length = 0;
    const controller = new AbortController();
    const part = fakeDeps();
    let decodes = 0;
    closable(part.deps, () => {
      if (++decodes === 3) controller.abort();
    });
    await expect(analyzeVideo(VIDEO, part.deps, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(closed).toHaveLength(3);
    expect(part.deps.makeCanvas).not.toHaveBeenCalled();
  });

  it("has no strip when no frame decodes", async () => {
    const { deps } = fakeDeps({ decodeFails: () => true });
    const { analysis, sheet } = await analyzeVideo(VIDEO, deps);
    expect(sheet).toBeNull();
    expect(analysis.sheet).toBeNull();
    expect(deps.makeCanvas).not.toHaveBeenCalled();
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("is drawn again at a lower quality, then with smaller tiles, until it fits", async () => {
    const { deps, canvases } = fakeDeps({ sheetBytes: (canvas) => (canvas.width > 300 ? LIMITS.styleSheetBytes + 1 : 50_000) });
    const { analysis, sheet } = await analyzeVideo(VIDEO, deps);
    expect(canvases.map((c) => [c.width, c.asked[0].quality])).toEqual([
      [540, 0.8],
      [540, 0.6],
      [404, 0.6],
      [272, 0.6],
    ]);
    expect(sheet!.size).toBe(50_000);
    expect(analysis.sheet).toMatchObject({ columns: 4, rows: 3 });
    // The small tiles' labels are a little smaller.
    expect(canvases[3].ops.find((op) => op[0] === "fillText")?.[5]).toContain("11px");
  });

  it("has no strip when even the smallest comes out too big", async () => {
    const { deps, canvases } = fakeDeps({ sheetBytes: () => LIMITS.styleSheetBytes + 1 });
    const { analysis, sheet } = await analyzeVideo(VIDEO, deps);
    expect(canvases).toHaveLength(4);
    expect(sheet).toBeNull();
    expect(analysis.sheet).toBeNull();
    expect(VideoAnalysis.parse(analysis)).toEqual(analysis);
  });

  it("labels moments as minutes, seconds and tenths", () => {
    expect(sheetLabel(0.2)).toBe("0:00.2");
    expect(sheetLabel(1.5)).toBe("0:01.5");
    expect(sheetLabel(61.55)).toBe("1:01.6");
    expect(sheetLabel(59.96)).toBe("1:00.0");
    expect(sheetLabel(3723.4)).toBe("1:02:03.4");
    expect(sheetLabel(0.15, 2)).toBe("0:00.15");
    expect(sheetLabel(3723.05, 2)).toBe("1:02:03.05");
    expect(sheetLabel(59.996, 2)).toBe("1:00.00");
  });

  it("labels every tile in hundredths when two would read the same in tenths, so each can be told apart", () => {
    expect(sheetLabels([0.2, 1.5, 3.25])).toEqual(["0:00.2", "0:01.5", "0:03.3"]);
    // A clip of 0.3 s, whose frames are 0.05 s or more apart.
    const times = sheetTimes([], 0.3);
    expect(new Set(times.map((t) => sheetLabel(t))).size).toBeLessThan(times.length);
    const labels = sheetLabels(times);
    expect(labels).toEqual(times.map((t) => sheetLabel(t, 2)));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("draws a very short clip's labels in hundredths", async () => {
    const { deps, canvases } = fakeDeps({ files: { "prev-a": { shots: [[0.3, RED]] }, "orig-a": { shots: [[0.3, RED]] } } });
    const { analysis } = await analyzeVideo(assetView({ ...VIDEO, durationMs: 300 }), deps);
    const drawn = canvases[0].ops.filter((op) => op[0] === "fillText").map((op) => op[1]);
    expect(drawn).toEqual(sheetLabels(analysis.sheet!.times));
    expect(drawn[0]).toMatch(/^0:00\.\d\d$/);
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

describe("which file is read", () => {
  it("is the preview copy, then the original, as Auto captions reads them", () => {
    expect(filesToTry(VIDEO)).toEqual(["prev-a", "orig-a"]);
    expect(filesToTry(assetView({ previewStatus: "pending", previewFileId: null }))).toEqual(["orig-a"]);
    const local = localFileId("a");
    expect(filesToTry(assetView({ previewStatus: "none", previewFileId: null, originalFileId: local }))).toEqual([local]);
  });

  it("falls back to the original when the preview can't be read or shows no picture", async () => {
    const missing = fakeDeps({ files: { "orig-a": THREE_SHOTS } });
    const one = await analyzeVideo(VIDEO, missing.deps);
    expect(missing.scanned.map((s) => s.file)).toEqual(["orig-a"]);
    expect(one.analysis.cuts).toEqual([2, 3.5]);

    const blank = fakeDeps({ files: { "prev-a": { noPicture: true }, "orig-a": THREE_SHOTS } });
    const two = await analyzeVideo(VIDEO, blank.deps);
    expect(blank.scanned.map((s) => s.file)).toEqual(["prev-a", "orig-a"]);
    expect(blank.decoded.every((d) => d.file === "orig-a")).toBe(true);
    expect(blank.transcribed).toEqual(["orig-a"]);
    expect(two.analysis.cuts).toEqual([2, 3.5]);
  });
});

describe("when a video can't be looked over", () => {
  const failure = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AnalyzeError);
    return { code: (error as AnalyzeError).code, reason: failureReason(error) };
  };

  it("says its file couldn't be opened, or showed no frames", async () => {
    expect(await failure(analyzeVideo(VIDEO, fakeDeps({ files: {} }).deps))).toEqual({ code: "unreadable", reason: STYLE_WORDS.analysisFailed.unreadable });
    const blank = fakeDeps({ files: { "prev-a": { noPicture: true }, "orig-a": { noPicture: true } } });
    expect(await failure(analyzeVideo(VIDEO, blank.deps))).toEqual({ code: "noPicture", reason: STYLE_WORDS.analysisFailed.noPicture });
  });

  it("says it was removed, is still uploading, or is too long, without reading it", async () => {
    const { deps } = fakeDeps();
    expect((await failure(analyzeVideo(assetView({ removed: true }), deps))).code).toBe("missing");
    expect((await failure(analyzeVideo(assetView({ status: "uploading", originalFileId: null }), deps))).code).toBe("notReady");
    const long = assetView({ durationMs: ANALYSIS_LIMITS.seconds * 1000 + 1000 });
    expect(await failure(analyzeVideo(long, deps))).toEqual({ code: "tooLong", reason: STYLE_WORDS.analysisFailed.tooLong });
    expect(deps.files.get).not.toHaveBeenCalled();
    // The words say the same length as the limit.
    expect(STYLE_WORDS.analysisFailed.tooLong).toContain(`${ANALYSIS_LIMITS.seconds / 3600} hours`);
  });

  it("gives the general words for anything else", () => {
    expect(failureReason(new Error("boom"))).toBe(STYLE_WORDS.analysisFailed.unknown);
    expect(failureReason(null)).toBe(STYLE_WORDS.analysisFailed.unknown);
  });

  it("keeps every reason short enough to be kept with the video", () => {
    for (const reason of Object.values(STYLE_WORDS.analysisFailed)) expect(reason.length).toBeLessThanOrEqual(LIMITS.styleShortTextChars);
  });
});

describe("canceling", () => {
  const abortError = { name: "AbortError" };

  it("stops before reading anything when the signal has already aborted", async () => {
    const { deps } = fakeDeps();
    await expect(analyzeVideo(VIDEO, deps, { signal: AbortSignal.abort() })).rejects.toMatchObject(abortError);
    expect(deps.files.get).not.toHaveBeenCalled();
  });

  it("stops part way through the frames, and goes no further", async () => {
    const controller = new AbortController();
    const frames: number[] = [];
    const { deps } = fakeDeps({
      onFrame: (t) => {
        frames.push(t);
        if (t >= 1) controller.abort();
      },
    });
    await expect(analyzeVideo(VIDEO, deps, { signal: controller.signal })).rejects.toMatchObject(abortError);
    expect(Math.max(...frames)).toBeLessThan(1.1);
    expect(deps.decodeVideoFrame).not.toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it("stops after reading the sound, without trying another file or listening", async () => {
    const controller = new AbortController();
    const { deps } = fakeDeps({ sound: { "prev-a": null, "orig-a": new Float32Array(2000).fill(0.5) } });
    deps.decodeSound.mockImplementation(async () => {
      controller.abort();
      return { ok: false as const, why: "unreadable" as const };
    });
    await expect(analyzeVideo(VIDEO, deps, { signal: controller.signal })).rejects.toMatchObject(abortError);
    expect(deps.decodeSound).toHaveBeenCalledOnce();
    expect(deps.fetchSavedTranscript).not.toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it("stops while listening, rather than going on without the words", async () => {
    const controller = new AbortController();
    const { deps } = fakeDeps();
    deps.transcribe.mockImplementation(async () => {
      controller.abort();
      throw new TranscribeError("cancelled", "Transcription was cancelled.");
    });
    await expect(analyzeVideo(VIDEO, deps, { signal: controller.signal })).rejects.toMatchObject(abortError);
    expect(deps.saveTranscript).not.toHaveBeenCalled();
  });
});

describe("the page's own deps", () => {
  it("read the words Auto captions saved, and save heard words as English, as Auto captions marks them", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ transcript: { words: WORDS, model: SPEECH_MODEL } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deps = browserAnalyzeDeps({ files: { get: vi.fn(), put: vi.fn() } } as unknown as MediaServices);
    expect(await deps.fetchSavedTranscript("a")).toEqual(WORDS);
    await deps.saveTranscript("a", WORDS);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/media/a/transcript");
    expect(JSON.parse(String(init?.body))).toEqual({ words: WORDS, model: SPEECH_MODEL });

    // Words heard as another language count too, so they are never heard again as English and written over.
    fetchMock.mockResolvedValueOnce(Response.json({ transcript: { words: WORDS, model: `${SPEECH_MODEL}#spanish` } }));
    expect(await deps.fetchSavedTranscript("a")).toEqual(WORDS);
  });
});
