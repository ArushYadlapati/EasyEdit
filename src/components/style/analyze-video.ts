import { decodeSound, type DecodedSound, type DecodeTrouble } from "@/lib/audio/decode";
import { measureLoudness } from "@/lib/audio/loudness";
import { toDb } from "@/lib/audio/meter";
import { TranscribeError, browserTranscriber, type TranscribeProgress } from "@/lib/captions/speech/client";
import { DEFAULT_SPEECH, speechTag } from "@/lib/captions/speech/languages";
import { fetchSavedTranscript, saveTranscriptToServer } from "@/lib/captions/transcript-client";
import { createCutFinder } from "@/lib/editor/scenes";
import { LIMITS } from "@/lib/limits";
import type { MediaFiles } from "@/lib/media/media-files";
import { playbackFileFor } from "@/lib/media/playback";
import type { AssetView } from "@/lib/media/types";
import type { ResolvedSource } from "@/lib/render/compositor";
import { STYLE_WORDS } from "@/lib/style/messages";
import { ANALYSIS_LIMITS, VideoAnalysis, type SheetPlan, type SoundFacts, type SpeechFacts } from "@/lib/style/types";
import { createColorMeter, cutList, sheetGrid, sheetTimes, shotStats, speechStats } from "@/lib/style/video-facts";
import type { CaptionWord } from "@/lib/timeline";
import { decodeVideoFrame, scanFrames } from "../editor/media/frame-decode";
import type { MediaServices } from "../editor/media/media-context";

// Looks over one of the space's own videos in this browser, for its style: how it is cut, its colours, how loud it
// is, what is said, and a strip of frames for agents to look at. Nothing leaves the browser but the numbers and the
// strip, which the caller saves. Everything the page provides comes in as deps, so tests run it on made-up frames.

const SCAN_SIDE = 64; // pixels on the longer side while looking for cuts, as Split at scene changes looks
const COLOR_EVERY = 0.25; // seconds between the frames whose colours are measured
const SHEET_TILE = 240; // a strip's tile on its longer side, in pixels, before it has to shrink to fit
const SHEET_QUALITY = 0.8;
// How a strip that comes out too big is made again, in turn: a lower quality, then smaller tiles.
const SHEET_TRIES: readonly { tile: number; quality: number }[] = [
  { tile: SHEET_TILE, quality: SHEET_QUALITY },
  { tile: SHEET_TILE, quality: 0.6 },
  { tile: 180, quality: 0.6 },
  { tile: 120, quality: 0.6 },
];
const SCAN_SHARE = 0.9; // of the "shots" step, the part that is reading every frame; the strip is the rest

// The steps a look-over goes through. analyzeVideo reports shots and listening; saving is the caller sending what was
// found, so a page can say all three in the same words.
export type AnalyzeStage = "shots" | "listening" | "saving";
// How far a step has got, from 0 to 1.
export type AnalyzeProgress = { stage: AnalyzeStage; done: number };

// The drawing a strip of frames needs from a canvas's 2D context; the page's and an off-screen canvas's both have it.
// roundRect is missing from a few older browsers, which get square labels.
export type SheetDrawing = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  roundRect?(x: number, y: number, width: number, height: number, radius: number): void;
  fill(): void;
};

// A canvas that is never shown, for drawing the strip on. toBlob answers null when nothing came out of it.
export type SheetCanvas = {
  getContext(kind: "2d"): SheetDrawing | null;
  toBlob(type: string, quality: number): Promise<Blob | null>;
};

// What looking over a video needs from the page; tests pass fakes. The real ones are browserAnalyzeDeps.
// fetchSavedTranscript: the words saved for the video in any language, since only how much and how fast it talks is
// counted; saveTranscript and transcribe: English as spoken, the words Auto captions uses first.
export type AnalyzeDeps = {
  files: MediaFiles;
  scanFrames(
    blob: Blob,
    from: number,
    to: number,
    side: number,
    each: (seconds: number, rgba: Uint8ClampedArray, width: number, height: number) => boolean | void,
  ): Promise<boolean>;
  decodeVideoFrame(blob: Blob, seconds: number, size: number): Promise<ResolvedSource | null>;
  decodeSound(blob: Blob): Promise<{ ok: true; sound: DecodedSound } | { ok: false; why: DecodeTrouble }>;
  transcribe(blob: Blob, opts: { signal?: AbortSignal; onProgress?: (p: TranscribeProgress) => void }): Promise<CaptionWord[]>;
  fetchSavedTranscript(assetId: string): Promise<CaptionWord[] | null>;
  saveTranscript(assetId: string, words: CaptionWord[]): Promise<unknown>;
  makeCanvas(width: number, height: number): SheetCanvas;
  now(): Date;
};

// Why a video couldn't be looked over, by the words that say so (STYLE_WORDS.analysisFailed).
export type AnalyzeFailure = keyof typeof STYLE_WORDS.analysisFailed;

// A look-over that couldn't finish. The message is for developers; failureReason gives the person's words.
export class AnalyzeError extends Error {
  readonly code: AnalyzeFailure;
  constructor(code: AnalyzeFailure, detail: string) {
    super(detail);
    this.name = "AnalyzeError";
    this.code = code;
  }
}

// What the person is told when looking over a video failed, as kept with the video in the style.
export function failureReason(error: unknown): string {
  return STYLE_WORDS.analysisFailed[error instanceof AnalyzeError ? error.code : "unknown"];
}

const canceled = () => new DOMException("Looking at the video was canceled.", "AbortError");

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// A moment of a video as a strip's tile shows it: "0:01.5", with hours "1:02:03.5".
export function sheetLabel(seconds: number): string {
  const tenths = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 10));
  const whole = Math.floor(tenths / 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = `${pad(whole % 60)}.${tenths % 10}`;
  return h > 0 ? `${h}:${pad(m)}:${s}` : `${m}:${s}`;
}

// The files a video can be read from, in the order to try them: the one it plays from (its preview copy, or its
// original when it has none yet), then the original when the first was the preview. The preview is a re-encode that
// can lose the picture or the sound; the original has both. As Auto captions reads them.
export function filesToTry(asset: AssetView): string[] {
  const playback = playbackFileFor(asset);
  const first = playback.fileId ?? asset.originalFileId;
  if (first === null) return [];
  const original = asset.originalFileId;
  return playback.fileId !== null && playback.from === "preview" && original !== null && original !== first ? [first, original] : [first];
}

// Each of the files to try, read once at most however often it is asked for. null: it couldn't be read.
function fileReader(files: MediaFiles, ids: readonly string[]): (index: number) => Promise<Blob | null> {
  const read = new Map<number, Promise<Blob | null>>();
  return (index) => {
    if (index >= ids.length) return Promise.resolve(null);
    let blob = read.get(index);
    if (!blob) {
      blob = files.get(ids[index]).then(
        (got) => (got.ok ? got.blob : null),
        () => null,
      );
      read.set(index, blob);
    }
    return blob;
  };
}

// Reports a step only when it has moved on by a whole percent, so a page redraws a hundred times a step at most. A step
// never goes back: starting over on the original file holds where the preview had got to until it passes it.
function reporter(onProgress: ((p: AnalyzeProgress) => void) | undefined): (stage: AnalyzeStage, done: number) => void {
  let last: AnalyzeProgress | null = null;
  return (stage, done) => {
    const at = round(clamp(Number.isFinite(done) ? done : 0, 0, 1), 2);
    const now = { stage, done: last && last.stage === stage ? Math.max(last.done, at) : at };
    if (last && last.stage === now.stage && last.done === now.done) return;
    last = now;
    onProgress?.(now);
  };
}

// What one pass over a file's frames found: where it cuts, its colours, the last moment seen, and the frames' size.
type Scan = { cuts: number[]; color: VideoAnalysis["color"]; frames: number; last: number; size: { width: number; height: number } };

async function scanVideo(
  deps: AnalyzeDeps,
  blob: Blob,
  seconds: number | null,
  signal: AbortSignal | undefined,
  report: (done: number) => void,
): Promise<Scan | null> {
  const finder = createCutFinder();
  const meter = createColorMeter();
  // Changed by each frame: when colours were last measured, the latest moment seen, and the first frame's size.
  const seen: { colorAt: number; last: number; size: Scan["size"] | null } = { colorAt: -Infinity, last: 0, size: null };
  // A video of unknown length is read no further than just past the longest a style looks at, which is then too long.
  const to = seconds ?? ANALYSIS_LIMITS.seconds + 1;
  const read = await deps
    .scanFrames(blob, 0, to, SCAN_SIDE, (t, rgba, width, height) => {
      if (signal?.aborted) return false;
      finder.add(t, rgba, width, height);
      if (t - seen.colorAt >= COLOR_EVERY - 1e-9) {
        meter.add(rgba, width, height);
        seen.colorAt = t;
      }
      seen.last = Math.max(seen.last, t);
      seen.size ??= { width, height };
      if (seconds) report(t / seconds);
    })
    .catch(() => false);
  if (signal?.aborted) throw canceled();
  if (!read || finder.frames() === 0 || !seen.size) return null;
  return { cuts: finder.cuts(), color: meter.result(), frames: finder.frames(), last: seen.last, size: seen.size };
}

// Draws the strip: the frames on a grid, each with its moment in a small dark label in its top-left corner, as a JPEG
// no bigger than a style keeps. Too big, it is drawn again at a lower quality, then with smaller tiles. null when no
// canvas could be had or nothing small enough came out.
async function drawSheet(
  deps: AnalyzeDeps,
  frames: readonly { t: number; image: CanvasImageSource }[],
  shape: { width: number; height: number },
  signal: AbortSignal | undefined,
): Promise<{ blob: Blob; columns: number; rows: number } | null> {
  for (const { tile, quality } of SHEET_TRIES) {
    if (signal?.aborted) throw canceled();
    const grid = sheetGrid(frames.length, shape.width, shape.height, tile);
    const canvas = deps.makeCanvas(grid.width, grid.height);
    const drawing = canvas.getContext("2d");
    if (!drawing) return null;
    drawing.fillStyle = "#000";
    drawing.fillRect(0, 0, grid.width, grid.height);
    const fontPx = tile >= 200 ? 12 : 11;
    drawing.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    drawing.textBaseline = "middle";
    frames.forEach(({ t, image }, i) => {
      const x = (i % grid.columns) * grid.tileW;
      const y = Math.floor(i / grid.columns) * grid.tileH;
      drawing.drawImage(image, x, y, grid.tileW, grid.tileH);
      const label = sheetLabel(t);
      const pillW = Math.ceil(drawing.measureText(label).width) + 10;
      const pillH = fontPx + 6;
      drawing.fillStyle = "rgba(0, 0, 0, 0.6)";
      if (drawing.roundRect) {
        drawing.beginPath();
        drawing.roundRect(x + 4, y + 4, pillW, pillH, pillH / 2);
        drawing.fill();
      } else drawing.fillRect(x + 4, y + 4, pillW, pillH);
      drawing.fillStyle = "#fff";
      drawing.fillText(label, x + 9, y + 4 + pillH / 2);
    });
    const blob = await canvas.toBlob("image/jpeg", quality).catch(() => null);
    if (!blob || blob.size === 0) return null;
    if (blob.size <= LIMITS.styleSheetBytes) return { blob, columns: grid.columns, rows: grid.rows };
  }
  return null;
}

// Frees a decoded frame that can be freed now; a decoder's canvas is left to the garbage collector.
function release(image: CanvasImageSource): void {
  const closable = image as { close?: unknown };
  if (typeof closable.close !== "function") return;
  try {
    (closable.close as () => void)();
  } catch {
    // already closed
  }
}

// The strip of frames, from the shots' middles (sheetTimes), and its plan. Both null when no frame could be decoded.
async function makeSheet(
  deps: AnalyzeDeps,
  blob: Blob,
  cuts: readonly number[],
  seconds: number,
  shape: { width: number; height: number },
  signal: AbortSignal | undefined,
  report: (done: number) => void,
): Promise<{ sheet: Blob; plan: SheetPlan } | { sheet: null; plan: null }> {
  const times = sheetTimes(cuts, seconds);
  const frames: { t: number; image: CanvasImageSource }[] = [];
  try {
    for (const [i, t] of times.entries()) {
      if (signal?.aborted) throw canceled();
      const frame = await deps.decodeVideoFrame(blob, t, SHEET_TILE).catch(() => null);
      if (frame) frames.push({ t, image: frame.image });
      report((i + 1) / times.length);
    }
    if (signal?.aborted) throw canceled();
    if (frames.length === 0) return { sheet: null, plan: null };
    const drawn = await drawSheet(deps, frames, shape, signal);
    if (!drawn) return { sheet: null, plan: null };
    return { sheet: drawn.blob, plan: { times: frames.map((f) => f.t), columns: drawn.columns, rows: drawn.rows } };
  } finally {
    for (const frame of frames) release(frame.image);
  }
}

// How loud the video is: its loudness and its loudest moment, in decibels to one place. null when it has no sound,
// or none could be read, or it is silence all through.
async function measureSound(
  deps: AnalyzeDeps,
  read: (index: number) => Promise<Blob | null>,
  from: number,
  tries: number,
  signal: AbortSignal | undefined,
): Promise<SoundFacts | null> {
  for (let i = from; i < tries; i++) {
    const blob = await read(i);
    if (signal?.aborted) throw canceled();
    if (!blob) continue;
    const decoded = await deps.decodeSound(blob).catch(() => ({ ok: false as const, why: "unreadable" as const }));
    if (signal?.aborted) throw canceled();
    if (!decoded.ok) continue;
    const measured = measureLoudness(decoded.sound.sides, decoded.sound.sampleRate);
    if (!measured) return null;
    const db = (n: number) => (Number.isFinite(n) ? clamp(round(n, 1), -120, 20) : -120);
    return { loudnessDb: db(measured.loudnessDb), peakDb: db(toDb(measured.peak)) };
  }
  return null;
}

// Where each part of hearing a file falls in the "listening" step, in the order the speech worker does them: reading
// the sound, getting the speech model (quick once this browser has it), then the words.
const LISTEN_PARTS: Record<TranscribeProgress["stage"], [number, number]> = { sound: [0, 0.1], model: [0.1, 0.3], speech: [0.3, 1] };

// What is said in the video. The words Auto captions saved for it are used when there are some, in whatever language
// they were heard; else it is heard here, as English, from the first file that has sound it can read, and the words are
// saved for Auto captions. Saved words are never heard again, so a transcript in another language is never written
// over. null when nothing was said, or anything went wrong: a video's other facts are worth keeping without its words.
async function listen(
  deps: AnalyzeDeps,
  asset: AssetView,
  read: (index: number) => Promise<Blob | null>,
  from: number,
  tries: number,
  seconds: number,
  signal: AbortSignal | undefined,
  report: (done: number) => void,
): Promise<SpeechFacts | null> {
  report(0);
  const saved = await deps.fetchSavedTranscript(asset.id).catch(() => null);
  if (signal?.aborted) throw canceled();
  if (saved && saved.length > 0) {
    report(1);
    return speechStats(saved, seconds);
  }
  // Auto captions hears no more than this either; its worker would refuse it after reading the whole sound.
  if (seconds > LIMITS.captionAudioMinutes * 60) return null;
  for (let i = from; i < tries; i++) {
    const blob = await read(i);
    if (signal?.aborted) throw canceled();
    if (!blob) continue;
    let words: CaptionWord[];
    try {
      words = await deps.transcribe(blob, {
        signal,
        onProgress: (p) => {
          const [start, end] = LISTEN_PARTS[p.stage] ?? [0, 0];
          report(start + (end - start) * (p.total > 0 ? p.done / p.total : 0));
        },
      });
    } catch (error) {
      if (signal?.aborted) throw canceled();
      const code = error instanceof TranscribeError ? error.code : "unknown";
      // A preview copy with no sound it can read: the original may have it.
      if (code === "no-sound" || code === "undecodable") continue;
      return null;
    }
    if (signal?.aborted) throw canceled();
    report(1);
    if (words.length > 0) {
      // Auto captions finds them next time. A save that fails costs only that.
      await deps.saveTranscript(asset.id, words).catch(() => undefined);
      if (signal?.aborted) throw canceled();
    }
    return speechStats(words, seconds);
  }
  return null;
}

// Looks over one of the space's own videos: one pass over its frames at 64 px for where it cuts and its colours; the
// strip of frames from the middles of its shots; how loud it is; and, unless listen is false, what is said. Reads the
// file it plays from, falling back to its original as Auto captions does. Reports where it has got to. Answers the
// facts, checked as a style keeps them, and the strip (a JPEG, or null when none could be drawn, and then the facts
// have no strip either). Rejects with an AnalyzeError when the video can't be looked over at all, and with an
// AbortError once the signal aborts.
export async function analyzeVideo(
  asset: AssetView,
  deps: AnalyzeDeps,
  options: { signal?: AbortSignal; onProgress?: (p: AnalyzeProgress) => void; listen?: boolean } = {},
): Promise<{ analysis: VideoAnalysis; sheet: Blob | null }> {
  const { signal, onProgress } = options;
  const listening = options.listen ?? true;
  if (signal?.aborted) throw canceled();
  if (asset.kind !== "video") throw new AnalyzeError("noPicture", "Only a video can be looked at.");
  if (asset.removed) throw new AnalyzeError("missing", "The video was removed from the media library.");
  if (asset.status !== "ready" || asset.originalFileId === null) throw new AnalyzeError("notReady", "The video is still uploading.");
  const known = asset.durationMs !== null && asset.durationMs > 0 ? asset.durationMs / 1000 : null;
  if (known !== null && known > ANALYSIS_LIMITS.seconds) throw new AnalyzeError("tooLong", "The video is longer than a style looks at.");

  const step = reporter(onProgress);
  step("shots", 0);
  const ids = filesToTry(asset);
  const read = fileReader(deps.files, ids);

  // The first file whose frames can be read is the one looked at.
  let found: { blob: Blob; index: number; scan: Scan } | null = null;
  let anyRead = false;
  for (let i = 0; i < ids.length && !found; i++) {
    const blob = await read(i);
    if (signal?.aborted) throw canceled();
    if (!blob) continue;
    anyRead = true;
    const scan = await scanVideo(deps, blob, known, signal, (done) => step("shots", done * SCAN_SHARE));
    if (scan) found = { blob, index: i, scan };
  }
  if (!found) throw anyRead ? new AnalyzeError("noPicture", "No frame of the video could be read.") : new AnalyzeError("unreadable", "The video's file couldn't be read.");
  const { blob, index, scan } = found;

  // A video the library doesn't know the length of runs to just past its last frame.
  const seconds = round(known ?? scan.last + 1 / 30, 3);
  if (!(seconds > 0)) throw new AnalyzeError("noPicture", "The video has no length.");
  if (seconds > ANALYSIS_LIMITS.seconds) throw new AnalyzeError("tooLong", "The video is longer than a style looks at.");
  // Its size as the library has it (as shown, after rotation); else the shape its frames were read at.
  const shape = asset.width !== null && asset.width > 0 && asset.height !== null && asset.height > 0 ? { width: asset.width, height: asset.height } : scan.size;
  const width = clamp(Math.round(shape.width), 1, ANALYSIS_LIMITS.side);
  const height = clamp(Math.round(shape.height), 1, ANALYSIS_LIMITS.side);

  const { sheet, plan } = await makeSheet(deps, blob, scan.cuts, seconds, { width, height }, signal, (done) => step("shots", SCAN_SHARE + (1 - SCAN_SHARE) * done));
  step("shots", 1);

  // Sound and words are read from the file looked at, then from the original when that was the preview.
  const tries = ids.length;
  const sound = asset.hasAudio ? await measureSound(deps, read, index, tries, signal) : null;
  if (signal?.aborted) throw canceled();
  const speech = listening && asset.hasAudio ? await listen(deps, asset, read, index, tries, seconds, signal, (done) => step("listening", done)) : null;
  if (signal?.aborted) throw canceled();

  const candidate = {
    kind: "video" as const,
    seconds,
    width,
    height,
    shots: shotStats(scan.cuts, seconds),
    cuts: cutList(scan.cuts, seconds),
    speech,
    sound,
    color: scan.color,
    sheet: plan,
    analyzedAt: deps.now().toISOString(),
  };
  const checked = VideoAnalysis.safeParse(candidate);
  if (!checked.success) throw new AnalyzeError("unknown", `What was measured didn't check: ${checked.error.message}`);
  return { analysis: checked.data, sheet };
}

// A canvas that is never added to the page: the page's own, or an off-screen one where there is no page.
function detachedCanvas(width: number, height: number): SheetCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return {
      getContext: () => canvas.getContext("2d"),
      toBlob: (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
    };
  }
  const canvas = new OffscreenCanvas(width, height);
  return {
    getContext: () => canvas.getContext("2d"),
    toBlob: (type, quality) => canvas.convertToBlob({ type, quality }).catch(() => null),
  };
}

// The real deps for this page: its media files, the browser's decoders, speech to text in a worker (started only if
// the video has no words saved yet), the words saved on the server (any language's; heard words are saved as English
// as spoken, as Auto captions marks them), and a canvas that is never shown.
export function browserAnalyzeDeps(media: MediaServices): AnalyzeDeps {
  const tag = speechTag(DEFAULT_SPEECH);
  const transcriber = browserTranscriber();
  return {
    files: media.files,
    scanFrames,
    decodeVideoFrame: (blob, seconds, size) => decodeVideoFrame(blob, seconds, size),
    decodeSound,
    transcribe: (blob, opts) => transcriber.transcribe(blob, opts),
    fetchSavedTranscript: (assetId) => fetchSavedTranscript(assetId),
    saveTranscript: (assetId, words) => saveTranscriptToServer(assetId, words, tag),
    makeCanvas: detachedCanvas,
    now: () => new Date(),
  };
}
