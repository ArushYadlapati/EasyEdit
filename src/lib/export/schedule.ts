import { KEYFRAME_SECONDS } from "@/lib/export/presets";
import type { TimelineDoc } from "@/lib/timeline";
import { docDuration } from "@/lib/timeline/presets";

// Which frame is shown when, which frames are keyframes, and where the sound track's blocks go between them.

// The project's length in frames; frames 0 … count − 1 are exported.
export function frameCount(doc: TimelineDoc): number {
  return docDuration(doc);
}

// A frame's time in seconds, always from its number and never by adding, so no error builds up over a long export.
export function frameTime(frame: number, fps: number): number {
  return frame / fps;
}

// Frame 0 and every KEYFRAME_SECONDS × fps frames after.
export function isKeyFrame(frame: number, fps: number): boolean {
  return frame % (KEYFRAME_SECONDS * fps) === 0;
}

export type AudioBlock = { beforeFrame: number; startSample: number; sampleCount: number };

// The sound track, exactly as long as the picture, cut into one block per second of picture. Block s starts at sample
// s × sampleRate and is written just before frame s × fps, so sound and picture reach the file side by side.
export function audioBlocks(totalFrames: number, fps: number, sampleRate: number): AudioBlock[] {
  const totalSamples = Math.ceil((totalFrames * sampleRate) / fps); // multiply first, so whole numbers stay whole
  const blocks: AudioBlock[] = [];
  for (let s = 0; s * sampleRate < totalSamples; s++) {
    const startSample = s * sampleRate;
    blocks.push({ beforeFrame: s * fps, startSample, sampleCount: Math.min(sampleRate, totalSamples - startSample) });
  }
  return blocks;
}

// How often the worker reports progress to the page.
export const PROGRESS_INTERVAL_MS = 100;
