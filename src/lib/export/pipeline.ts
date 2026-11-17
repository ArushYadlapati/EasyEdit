import { createDecodePool, type DecodePool, type MediaIO } from "@/lib/export/decode-pool";
import { mismatchedProbe, type FontFaceSpec } from "@/lib/export/fonts";
import { mediaSchedule } from "@/lib/export/media-schedule";
import { clipSizes } from "@/lib/export/needed-size";
import { ExportError, failureOf } from "@/lib/export/messages";
import { AUDIO, type Acceleration, type VideoSettings } from "@/lib/export/presets";
import type { ExportFailure, ExportJob, FromWorker } from "@/lib/export/protocol";
import { PROGRESS_INTERVAL_MS, audioBlocks, frameCount, frameTime, isKeyFrame, type AudioBlock } from "@/lib/export/schedule";
import { createSoundPool, type SoundIO, type SoundPool } from "@/lib/export/sound-pool";
import { soundSchedule } from "@/lib/export/sound-schedule";
import type { ResolvedSource } from "@/lib/render/compositor";

// The order of steps for one export inside the worker, against an injected encoder and decoders. Each step either
// passes or ends the export with the failure it names. The frame loop waits only on the encoder's and the decoders'
// promises, never on a timer, so a slow disk, encoder or decoder holds the next frame back and a hidden tab does not.

export type OpenOptions = { video: VideoSettings; acceleration: Acceleration; audio: boolean };

// One open encoder and file writer. The worker entry builds it from an OffscreenCanvas and Mediabunny.
export type PipelineOutput = {
  draw(frame: number, sources: ReadonlyMap<string, ResolvedSource>): void; // paints the frame; a clip with no picture here draws its placeholder
  addFrame(frame: number, seconds: number, duration: number, keyFrame: boolean): Promise<void>; // encodes what is painted; resolves when there is room for the next
  addSound(startSample: number, sampleCount: number, data: Float32Array): Promise<void>; // interleaved stereo f32, sampleCount × 2
  finish(): Promise<number>; // closes the file; its size in bytes
  cancel(): Promise<void>; // releases the encoders
};

export type PipelineIO = {
  supported(): boolean; // OffscreenCanvas, VideoEncoder, VideoFrame and a font set exist in this scope
  loadFace(spec: FontFaceSpec): Promise<boolean>; // true once the face is loaded and registered
  measure(font: string, text: string): number;
  canEncode(video: VideoSettings, acceleration: Acceleration): Promise<boolean>;
  canEncodeAudio(): Promise<boolean>;
  media: MediaIO;
  sound: SoundIO;
  open(options: OpenOptions): Promise<PipelineOutput>;
};

export type PipelineControl = { onProgress(framesDone: number, totalFrames: number): void; now(): number };

export type PipelineResult = Extract<FromWorker, { type: "done" | "failed" }>;

// What is still open when the steps end: released after the result, never waited on.
type Held = { out: PipelineOutput | null; pool: DecodePool | null; sounds: SoundPool | null };

const failed = (code: ExportFailure, detail = ""): PipelineResult => ({ type: "failed", code, detail });

// Runs one call of a step; a throw becomes that step's failure, with the error's message.
async function as<T>(code: ExportFailure, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new ExportError(code, failureOf(error, code).detail);
  }
}

// A check whose rejection means no.
async function answer(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

// Starts a release without waiting for it: a cleanup that hangs or fails must not hold back the result.
function letGo(release: () => Promise<unknown>): void {
  try {
    void release().catch(() => {});
  } catch {
    // the worker is terminated after every try anyway
  }
}

async function steps(job: ExportJob, io: PipelineIO, control: PipelineControl, held: Held): Promise<PipelineResult> {
  const { video, acceleration } = job;
  const fps = video.fps;

  // 1–2. A browser that can export, and something to export.
  if (!io.supported()) return failed("unsupported");
  const total = frameCount(job.doc);
  if (total <= 0) return failed("empty");

  // 3. Every face, in order. A face that points only at an installed font may be missing, as on the page.
  for (const spec of job.fonts.faces) {
    if (!(await answer(() => io.loadFace(spec))) && spec.required) return failed("font", spec.family);
  }

  // 4. The text measures here as it did on the page.
  const mismatch = mismatchedProbe(job.fonts.probes, (font, text) => io.measure(font, text));
  if (mismatch) return failed("font-mismatch", mismatch.font);

  // 5. This computer can encode this size.
  if (!(await io.canEncode(video, acceleration))) return failed("size");

  // 6. Every video file can be decoded here, before the encoder opens. Each clip's picture is decoded at the size this
  // export draws it.
  let pool: DecodePool;
  try {
    const sizeOf = clipSizes(job.doc, { width: video.width, height: video.height });
    pool = createDecodePool(mediaSchedule(job.doc, job.media.clips), job.media.files, io.media, sizeOf);
    await pool.open();
  } catch (error) {
    const { code, detail } = failureOf(error, "decode");
    return failed(code, detail);
  }
  held.pool = pool;

  // 7. A sound track only when the page planned one and this worker can encode AAC: the page and the worker ask
  // separately, so a page that said "no sound track" never gets a silent one.
  const audio = job.sound && (await answer(() => io.canEncodeAudio()));

  // 7b. Every sounding file can be decoded here, before the file is made.
  let sounds: SoundPool | null = null;
  if (audio) {
    try {
      sounds = createSoundPool(soundSchedule(job.doc, job.media.sounds, fps, AUDIO.sampleRate), job.media.files, io.sound);
      held.sounds = sounds;
      await sounds.open();
    } catch (error) {
      const { code, detail } = failureOf(error, "sound");
      return failed(code, detail);
    }
  }

  // 8. The encoder.
  let out: PipelineOutput;
  try {
    out = await io.open({ video, acceleration, audio });
  } catch (error) {
    return failed("encoder", failureOf(error, "encoder").detail);
  }
  held.out = out;

  // 9. Each frame waits for its sound block, its pictures and the encoder's room before the next is drawn.
  const blocks = new Map<number, AudioBlock>(audio ? audioBlocks(total, fps, AUDIO.sampleRate).map((block) => [block.beforeFrame, block]) : []);
  let reported: number | null = null;
  for (let n = 0; n < total; n++) {
    const block = blocks.get(n);
    if (block && sounds) {
      const data = await sounds.block(block).catch((error: unknown) => {
        const { code, detail } = failureOf(error, "sound"); // the pool names media, sound or encoder itself
        throw new ExportError(code, detail);
      });
      await as("encoder", () => out.addSound(block.startSample, block.sampleCount, data));
    }
    const sources = await pool.frame(n).catch((error: unknown) => {
      const { code, detail } = failureOf(error, "decode"); // the pool names media, decode or encoder itself
      throw new ExportError(code, detail);
    });
    try {
      out.draw(n, sources);
    } catch (error) {
      throw new ExportError("unknown", failureOf(error, "unknown").detail);
    }
    await as("encoder", () => out.addFrame(n, frameTime(n, fps), 1 / fps, isKeyFrame(n, fps)));

    const now = control.now();
    if (reported === null || now - reported >= PROGRESS_INTERVAL_MS || n + 1 === total) {
      reported = now;
      control.onProgress(n + 1, total);
    }
  }

  // 10. The file.
  const bytes = await as("encoder", () => out.finish());
  held.out = null; // a finished file has no encoder left to cancel
  return { type: "done", bytes, hasAudio: audio };
}

// Never rejects: anything unexpected is an unknown failure. The result settles first; what is still open is released
// after it, one after the other, without waiting.
export function runPipeline(job: ExportJob, io: PipelineIO, control: PipelineControl): Promise<PipelineResult> {
  const held: Held = { out: null, pool: null, sounds: null };
  const result = steps(job, io, control, held).catch((error: unknown): PipelineResult => {
    const { code, detail } = failureOf(error, "unknown");
    return failed(code, detail);
  });
  void result.then(() => {
    const { out, pool, sounds } = held;
    if (out) letGo(() => out.cancel());
    if (pool) letGo(() => pool.close());
    if (sounds) letGo(() => sounds.close());
  });
  return result;
}
