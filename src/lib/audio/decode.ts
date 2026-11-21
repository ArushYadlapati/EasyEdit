// Reads a media file's sound into memory for measuring, at a rate low enough that a long file stays small. Browser only.

export const MEASURE_RATE = 22050; // plenty to tell how loud speech and music are, and half the memory of 44.1 kHz
export const MEASURE_MAX_BYTES = 400 * 1024 * 1024; // a file past this is not read whole into memory

export type DecodedSound = { sides: Float32Array[]; sampleRate: number };

export type DecodeTrouble = "unsupported" | "too-large" | "unreadable";

// The file's sound, every side, resampled to MEASURE_RATE. A video file gives its sound track.
export async function decodeSound(blob: Blob): Promise<{ ok: true; sound: DecodedSound } | { ok: false; why: DecodeTrouble }> {
  const Offline = typeof window === "undefined" ? undefined : window.OfflineAudioContext;
  if (!Offline) return { ok: false, why: "unsupported" };
  if (blob.size > MEASURE_MAX_BYTES) return { ok: false, why: "too-large" };
  try {
    const ctx = new Offline(2, 1, MEASURE_RATE);
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const sides = Array.from({ length: buffer.numberOfChannels }, (_, side) => buffer.getChannelData(side));
    return { ok: true, sound: { sides, sampleRate: buffer.sampleRate } };
  } catch {
    return { ok: false, why: "unreadable" };
  }
}
