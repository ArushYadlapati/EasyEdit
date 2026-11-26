import { fitRect } from "@/lib/render/compositor";
import { noLargerThan, type PictureSize } from "@/lib/render/decode-image";
import { ZOOM_TRANSITION_SCALE } from "@/lib/render/effects";
import type { MediaClip, TimelineDoc, Transform } from "@/lib/timeline";
import { stretchOf } from "@/lib/timeline/presets";
import { expandNests } from "@/lib/timeline/nest";

// The size each clip's picture is decoded at for an export: as large as the frame draws it, so no source pixel is
// stretched over more than one export pixel, and no larger, so a small picture in picture holds small canvases.

// The hard cap on a decoded picture's long side. A source larger than the frame draws it decodes at its native size up
// to here: 4096 covers a 4K source shown whole, and a 1080p export zoomed in about 2×, while a zoomed-in 8000 × 6000
// photo holds a 4096 × 3072 bitmap (48 MB) instead of 7680 × 5760 (177 MB). Past it, the frame is upscaled a little.
export const DECODE_SIDE_MAX = 4096;

// A rounding error must not ask for one pixel more than the frame draws, or than the source has.
const up = (value: number): number => Math.ceil(value - 1e-6);

// One size serves the whole clip, so it is taken at the clip's largest scale (peakTransform). Rotation turns the
// picture without changing its size. A crop draws the kept share of the source into the same share of the box
// (compositor.ts drawMedia), so it needs no more pixels. A stretch widens only the width, so the larger of the two
// axes' needs sets the size; the decoded picture keeps the source's shape. The output's two scales are taken at the
// larger, since a rotated clip turns one axis into the other.
export function neededSize(
  doc: PictureSize,
  transform: Pick<Transform, "fit" | "scale" | "stretch">,
  output: PictureSize,
  source: PictureSize,
): PictureSize {
  const fitted = fitRect(source.width, source.height, doc.width, doc.height, transform.fit);
  const outputScale = Math.max(output.width / doc.width, output.height / doc.height);
  const drawnWidth = fitted.width * transform.scale * stretchOf(transform) * outputScale;
  const drawnHeight = fitted.height * transform.scale * outputScale;
  const long = Math.max(source.width, source.height);
  const k = Math.min(Math.max(drawnWidth / source.width, drawnHeight / source.height), 1, DECODE_SIDE_MAX / long);
  return {
    width: Math.min(source.width, Math.max(1, up(source.width * k))),
    height: Math.min(source.height, Math.max(1, up(source.height * k))),
  };
}

// The clip's transform at the largest scale it is drawn at. Keyframed scale replaces the transform's own, and the
// eases never overshoot, so the curve's peak is its largest keyframe (one outside the clip only shapes the curve, so
// counting it can only ask for more). A zoom transition draws the clip up to ZOOM_TRANSITION_SCALE larger on top.
// Position, rotation and opacity keyframes don't change how large the picture is drawn.
export function peakTransform(clip: MediaClip): Transform {
  const keyed = clip.keyframes?.scale;
  let scale = keyed && keyed.length > 0 ? Math.max(...keyed.map((k) => k.value)) : clip.transform.scale;
  if (clip.transitionIn?.kind === "zoom" || clip.transitionOut?.kind === "zoom") scale *= ZOOM_TRANSITION_SCALE;
  return scale === clip.transform.scale ? clip.transform : { ...clip.transform, scale };
}

// Each video or image clip of the doc by its id: the size to decode its source at. A clip the doc does not have
// (never, for a schedule made from the same doc) keeps the old rule, the output's long side.
export function clipSizes(doc: TimelineDoc, output: PictureSize): (clipId: string, source: PictureSize) => PictureSize {
  const transforms = new Map<string, Transform>();
  // A nest's clips are drawn at their own sizes before the nest is placed.
  for (const track of expandNests(doc).tracks) {
    for (const clip of track.clips) if (clip.type === "video" || clip.type === "image") transforms.set(clip.id, peakTransform(clip));
  }
  const fallback = noLargerThan(Math.max(output.width, output.height));
  return (clipId, source) => {
    const transform = transforms.get(clipId);
    return transform ? neededSize(doc, transform, output, source) : fallback(source);
  };
}
