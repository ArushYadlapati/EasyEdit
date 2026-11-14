// Draws, encodes and writes one export. It holds the job's document, its fonts and its media Blobs; no secret, and it
// makes no network request but for the font files the page named. Every decision is in pipeline.ts, decode-pool.ts and
// worker-session.ts; this file wires them to the canvas, the encoders, the decoders and Mediabunny.
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  type WrappedCanvas,
} from "mediabunny";
import { CHUNK_BYTES, type ChunkBridge } from "@/lib/export/chunk-bridge";
import { fileGone, type MediaIO } from "@/lib/export/decode-pool";
import { jobFontResolver, type FontFaceSpec } from "@/lib/export/fonts";
import { exportPlaceholderLabel } from "@/lib/export/media-schedule";
import { runPipeline, type OpenOptions, type PipelineIO, type PipelineOutput } from "@/lib/export/pipeline";
import { AUDIO, KEYFRAME_SECONDS, encoderConfig, type Acceleration, type VideoSettings } from "@/lib/export/presets";
import type { ExportJob, ToWorker } from "@/lib/export/protocol";
import { createWorkerSession } from "@/lib/export/worker-session";
import { drawFrame, type ResolvedSource } from "@/lib/render/compositor";
import { decodeImage } from "@/lib/render/decode-image";

// The typings know only the page's fonts; a worker has its own set.
const fontSet = (self as unknown as { fonts: FontFaceSet }).fonts;

function supported(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof FontFace !== "undefined" &&
    "fonts" in self
  );
}

async function loadFace(spec: FontFaceSpec): Promise<boolean> {
  try {
    const face = new FontFace(spec.family, spec.source, spec.descriptors as FontFaceDescriptors);
    await face.load();
    fontSet.add(face);
    return face.status === "loaded";
  } catch {
    return false;
  }
}

let measuring: OffscreenCanvasRenderingContext2D | null = null;

function measure(font: string, text: string): number {
  measuring ??= new OffscreenCanvas(1, 1).getContext("2d");
  if (!measuring) throw new Error("The measuring canvas has no 2D context.");
  measuring.font = font;
  return measuring.measureText(text).width;
}

async function canEncode(video: VideoSettings, acceleration: Acceleration): Promise<boolean> {
  try {
    return (await VideoEncoder.isConfigSupported(encoderConfig(video, acceleration))).supported === true;
  } catch {
    return false;
  }
}

async function canEncodeAudio(): Promise<boolean> {
  try {
    if (typeof AudioEncoder === "undefined") return false;
    const config = { codec: AUDIO.codec, sampleRate: AUDIO.sampleRate, numberOfChannels: AUDIO.channels, bitrate: AUDIO.bitrate };
    return (await AudioEncoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

// Mediabunny reads each Blob in place; a sink makes OffscreenCanvases here, with the file's rotation drawn in.
const media: MediaIO = {
  async canDecode(blob) {
    // A read-ahead that fails while nothing waits for it is dropped: the read that needs those bytes fails through its reader.
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob, { handleUnhandledError: () => {} }) });
    try {
      const track = await input.getPrimaryVideoTrack();
      return track !== null && (await track.canDecode());
    } catch (error) {
      if (fileGone(error)) throw error;
      return false;
    } finally {
      input.dispose();
    }
  },
  async openVideo(blob, maxSide) {
    // A read-ahead that fails while nothing waits for it is dropped: the read that needs those bytes fails through its reader.
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob, { handleUnhandledError: () => {} }) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("The file has no video track.");
      const width = await track.getDisplayWidth();
      const height = await track.getDisplayHeight();
      const k = maxSide / Math.max(width, height);
      const size = k < 1 ? { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), fit: "fill" as const } : {};
      return {
        firstTimestamp: await track.getFirstTimestamp(),
        pictures: (seconds) => pictures(new CanvasSink(track, { ...size, poolSize: 2 }).canvasesAtTimestamps(seconds)),
        dispose: () => input.dispose(),
      };
    } catch (error) {
      input.dispose();
      throw error;
    }
  },
  async decodeImage(blob, maxSide) {
    const decoded = await decodeImage(blob, maxSide);
    return { ...decoded, close: () => decoded.image.close() };
  },
};

// A sink's canvases as the pool's pictures. Returning early stops the sink and closes what it holds. The last two
// canvases it gave (the sink's pool) are shrunk to nothing at the end, so their memory goes at once, not whenever
// the worker's garbage collector runs: a montage of many short cuts makes a sink per cut.
async function* pictures(canvases: AsyncGenerator<WrappedCanvas | null, void, unknown>): AsyncGenerator<ResolvedSource | null, void, unknown> {
  const given: (OffscreenCanvas | HTMLCanvasElement)[] = []; // poolSize 2: the sink reuses two canvases, so this holds two at most
  try {
    for await (const wrapped of canvases) {
      if (wrapped && !given.includes(wrapped.canvas)) given.push(wrapped.canvas);
      yield wrapped ? { image: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height } : null;
    }
  } finally {
    for (const canvas of given) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

async function open(job: ExportJob, options: OpenOptions, bridge: ChunkBridge): Promise<PipelineOutput> {
  const { video } = options;
  const canvas = new OffscreenCanvas(video.width, video.height);
  const ctx = canvas.getContext("2d"); // default options, like the preview's canvas, so text is drawn the same way
  if (!ctx) throw new Error("The export canvas has no 2D context."); // Task 20 finds this string in the built worker
  ctx.setTransform(video.width / job.doc.width, 0, 0, video.height / job.doc.height, 0, 0); // drawFrame draws in project pixels
  const resolveFont = jobFontResolver(job.fonts.families);
  const placeholderLabel = exportPlaceholderLabel(job.media.clips);

  const output = new Output({
    // The index at the end on every path: the worker never holds the file, and every destination patches the start (Task 10).
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(new WritableStream(bridge.sink), { chunked: true, chunkSize: CHUNK_BYTES }),
  });
  const picture = new CanvasSource(canvas, {
    codec: "avc",
    quality: new Quality({ bitrate: video.bitrate }),
    fullCodecString: video.codec,
    hardwareAcceleration: options.acceleration,
    latencyMode: "quality", // never drop a frame
    keyFrameInterval: KEYFRAME_SECONDS,
  });
  output.addVideoTrack(picture, { frameRate: video.fps }); // snaps every timestamp to the frame rate: the length is exact
  const sound = options.audio ? new AudioSampleSource({ codec: "aac", quality: new Quality({ bitrate: AUDIO.bitrate }) }) : null;
  if (sound) output.addAudioTrack(sound);
  await output.start();

  return {
    draw: (frame, sources) =>
      drawFrame(ctx, job.doc, frame, { resolveFont, placeholderLabel, resolveSource: (clip) => sources.get(clip.id) ?? null }),
    addFrame: (_frame, seconds, duration, keyFrame) => picture.add(seconds, duration, { keyFrame }),
    async addSilence(startSample, sampleCount) {
      const sample = new AudioSample({
        data: new Float32Array(sampleCount * AUDIO.channels), format: "f32",
        numberOfChannels: AUDIO.channels, sampleRate: AUDIO.sampleRate, timestamp: startSample / AUDIO.sampleRate,
      });
      await sound?.add(sample);
      sample.close();
    },
    async finish() {
      picture.close();
      sound?.close();
      await output.finalize();
      return bridge.bytes();
    },
    cancel: () => output.cancel(),
  };
}

// The PipelineIO for one job.
function makeIO(job: ExportJob, bridge: ChunkBridge): PipelineIO {
  return { supported, loadFace, measure, canEncode, canEncodeAudio, media, open: (options) => open(job, options, bridge) };
}

const session = createWorkerSession(
  (job, bridge, control) => runPipeline(job, makeIO(job, bridge), control),
  (message, transfer) => self.postMessage(message, { transfer }),
  () => performance.now(),
);

self.addEventListener("message", (event: MessageEvent<ToWorker>) => session.receive(event.data));
self.addEventListener("messageerror", () => session.crash("A message could not be read."));
self.addEventListener("unhandledrejection", (event) => session.crash(String(event.reason)));
