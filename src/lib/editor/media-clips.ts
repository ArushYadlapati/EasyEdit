import { sourceFrames } from "@/lib/media/rules";
import type { AssetKind } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, type MediaClip } from "@/lib/timeline";

export const DEFAULT_IMAGE_SECONDS = 3;

// What a new clip needs to know about its asset. An AssetView and the server's AssetFact both fit.
export type ClipSource = { id: string; kind: AssetKind; durationMs: number | null };

// An asset's length in a project's frames, or undefined when it has none (an image) or is not known.
export function mediaLengthFrames(asset: ClipSource | undefined, fps: number): number | undefined {
  return asset && asset.durationMs !== null ? sourceFrames(asset.durationMs, fps) : undefined;
}

// A new clip for an asset, without an id. Video and audio: from inSeconds (default 0) for durationSeconds
// (default: to the end), never past the end. An image: durationSeconds, default 3. Null when inSeconds is at or
// past the end, and for a video or audio of unknown length (the library holds none: its length is required).
export function mediaClipFor(
  asset: ClipSource,
  start: number,
  fps: number,
  opts: { inSeconds?: number; durationSeconds?: number } = {},
): Omit<MediaClip, "id"> | null {
  const clip = { type: asset.kind, assetId: asset.id, start, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } };
  if (asset.kind === "image") {
    const duration = Math.max(1, Math.round((opts.durationSeconds ?? DEFAULT_IMAGE_SECONDS) * fps));
    return { ...clip, duration, in: 0 };
  }
  if (asset.durationMs === null) return null;
  const frames = sourceFrames(asset.durationMs, fps);
  const sourceIn = Math.round((opts.inSeconds ?? 0) * fps);
  if (sourceIn >= frames) return null;
  const room = frames - sourceIn;
  const wanted = opts.durationSeconds === undefined ? room : Math.round(opts.durationSeconds * fps);
  return { ...clip, duration: Math.min(room, Math.max(1, wanted)), in: sourceIn };
}

// How far a clip's edges can go before its media runs out, in timeline frames: exactly what the engine and the
// server accept. A start trim keeps where the clip ends in its footage (in = end − round(duration × speed)), so the
// start can go back while that `in` stays inside the media; the end can go on while the clip's last frame does. A clip
// that plays backward uses its footage the other way round: its end runs towards the media's start, its start towards
// the media's end. Undefined for an image, a clip that holds one frame, or an unknown length.
export function trimBounds(clip: MediaClip, lengthFrames: number | undefined): { minStart: number; maxEnd: number } | undefined {
  const reach = trimReach(clip, lengthFrames);
  return reach && { minStart: Math.max(0, clip.start - reach.back), maxEnd: clip.start + reach.longest };
}

// The same limits as frame counts: how many frames a start trim can add at the clip's head (back), whatever lies
// before it on the timeline, and the longest the clip can be from where it starts. A ripple trim, which makes its own
// room, reads these.
export function trimReach(clip: MediaClip, lengthFrames: number | undefined): { back: number; longest: number } | undefined {
  if (clip.type === "image" || lengthFrames === undefined || clip.speed === 0) return undefined;
  const rate = Math.abs(clip.speed);
  // The frames of media a clip this long uses. Rounded as the engine rounds it, with the speed's sign, so a half frame falls the same way here and there.
  const way = clip.speed > 0 ? 1 : -1;
  const used = (duration: number) => way * Math.round(duration * clip.speed);
  // ahead: the frames of media left from `in` in the way the clip plays. total: the most it may use after a start
  // trim, counted from where it ends.
  const ahead = clip.speed > 0 ? lengthFrames - clip.in : clip.in + 1;
  const total = clip.speed > 0 ? clip.in + used(clip.duration) : lengthFrames - 1 - clip.in + used(clip.duration);

  let longest = Math.floor((ahead + 0.5) / rate);
  while (used(longest) > ahead) longest--;

  let back = Math.floor((total + 0.5) / rate) - clip.duration;
  while (back > 0 && used(clip.duration + back) > total) back--;

  return { back: Math.max(0, back), longest };
}
