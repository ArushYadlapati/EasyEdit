import type { MediaClip, OpInput } from "@/lib/timeline";

// Finding where a video cuts from one shot to the next, and splitting a clip there. A frame is reduced to how its
// colours are spread in each quarter of the picture; a cut is a frame that looks unlike the one before it, far more
// than the frames around it differ from theirs. Pure: frames come in as pixels.

const LEVELS = 4; // per colour channel: 64 colours
const BINS = LEVELS ** 3;
const QUARTERS = 4;

// A frame's look: for each quarter of the picture, the share of its pixels in each of 64 colours. Quarters, so that
// two shots with the same colours in different places are told apart.
export function frameLook(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const look = new Float32Array(QUARTERS * BINS);
  const counts = new Float32Array(QUARTERS);
  for (let y = 0; y < height; y++) {
    const row = y * 2 >= height ? 2 : 0;
    for (let x = 0; x < width; x++) {
      const quarter = row + (x * 2 >= width ? 1 : 0);
      const i = (y * width + x) * 4;
      look[quarter * BINS + (rgba[i] >> 6) * LEVELS * LEVELS + (rgba[i + 1] >> 6) * LEVELS + (rgba[i + 2] >> 6)]++;
      counts[quarter]++;
    }
  }
  for (let q = 0; q < QUARTERS; q++) if (counts[q] > 0) for (let b = 0; b < BINS; b++) look[q * BINS + b] /= counts[q];
  return look;
}

// How unlike two looks are: 0 the same, 1 nothing in common.
export function lookDifference(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (2 * QUARTERS);
}

export const CUT_DIFFERENCE = 0.3; // a frame this unlike the one before it may start a new shot
export const CUT_AGAINST_AROUND = 3; // and it has to be this many times what the frames around it differ by
const AROUND = 5; // frames looked at on each side
export const CUT_MIN_GAP_SECONDS = 0.5; // two cuts closer than this are one (a flash, a white frame)

// Which frames start a new shot. differences[i]: how unlike frame i is from frame i − 1 (differences[0] is unused).
// Fast motion and a zoom differ frame after frame, a cut differs once: the frames around it are the measure.
// minGap: the fewest frames between two cuts; of two closer than that, the stronger stays.
export function cutsIn(differences: ArrayLike<number>, minGap: number): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < differences.length; i++) {
    const d = differences[i];
    if (d < CUT_DIFFERENCE) continue;
    let around = 0;
    let n = 0;
    for (let j = Math.max(1, i - AROUND); j <= Math.min(differences.length - 1, i + AROUND); j++) {
      if (j === i) continue;
      around += differences[j];
      n++;
    }
    if (n > 0 && d < CUT_AGAINST_AROUND * (around / n)) continue;
    const last = cuts.at(-1);
    if (last !== undefined && i - last < minGap) {
      if (d > differences[last]) cuts[cuts.length - 1] = i;
    } else cuts.push(i);
  }
  return cuts;
}

// Takes a video's frames in order and says at which moments of the file a new shot starts.
export function createCutFinder(): { add(seconds: number, rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): void; cuts(): number[]; frames(): number } {
  const times: number[] = [];
  const differences: number[] = [];
  let before: Float32Array | null = null;
  return {
    add(seconds, rgba, width, height) {
      const look = frameLook(rgba, width, height);
      times.push(seconds);
      differences.push(before ? lookDifference(before, look) : 0);
      before = look;
    },
    cuts() {
      if (times.length < 2) return [];
      const perSecond = (times.length - 1) / Math.max(1e-6, times[times.length - 1] - times[0]);
      return cutsIn(differences, Math.max(1, Math.round(CUT_MIN_GAP_SECONDS * perSecond))).map((i) => times[i]);
    },
    frames: () => times.length,
  };
}

// The timeline frame at which a moment of a clip's file is shown. For a clip that plays forward.
export function frameOfMoment(clip: Pick<MediaClip, "start" | "in" | "speed">, seconds: number, fps: number): number {
  return clip.start + Math.round((seconds * fps - clip.in) / clip.speed);
}

// The ops that split a clip at each of these timeline frames, as one change: the first split leaves the clip its
// first shot, and each later one splits the piece the split before it made. Frames outside the clip, on its edges,
// or given twice are left out. clipIds: the shots in order, the first being the clip itself.
export function sceneSplitOps(clip: Pick<MediaClip, "id" | "start" | "duration">, frames: number[], ids: () => string): { ops: OpInput[]; clipIds: string[] } {
  const inside = [...new Set(frames)].filter((f) => f > clip.start && f < clip.start + clip.duration).sort((a, b) => a - b);
  const clipIds = [clip.id];
  const ops: OpInput[] = inside.map((at) => {
    const newClipId = ids();
    const op: OpInput = { op: "split_clip", clipId: clipIds[clipIds.length - 1], at, newClipId };
    clipIds.push(newClipId);
    return op;
  });
  return { ops, clipIds };
}
