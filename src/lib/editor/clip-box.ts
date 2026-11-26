import { cropRect, mediaSize, type LocalRect } from "@/lib/render/compositor";
import { textRect } from "@/lib/render/text-layout";
import type { TextSpan } from "@/lib/timeline";
import { stretchOf } from "@/lib/timeline/presets";
import { shapeBox } from "@/lib/timeline/shapes";
import type { Clip, FrameSize, MediaClip, PlaceholderClip, TextClip, TimelineDoc } from "@/lib/timeline";

// What a clip's box is measured with: the picture size of a video or image (null when it is not known, so the
// placeholder's whole frame), and the width of a line of text in the clip's font.
export type Sizer = {
  source(clip: MediaClip): { width: number; height: number } | null;
  measure(clip: TextClip, s: string): number;
  // The same in a styled span's look (bolder, slanted). Without it a text with spans is boxed as if it had none.
  measureSpan?(clip: TextClip, s: string, span: TextSpan | null): number;
};

// The least share of a clip's width or height a crop typed or dragged by hand leaves showing.
export const CROP_MIN_SHOWN = 0.05;

// A clip's box as the preview draws it, from its centre, before scale, stretch and rotation: the whole picture or
// text box, and the part the crop keeps. Audio has none.
export function clipRects(doc: TimelineDoc, clip: Clip, sizer: Sizer): { full: LocalRect; kept: LocalRect } | null {
  // Sound and an adjustment layer have no box on the frame.
  if (clip.type === "audio" || clip.type === "adjustment" || (clip.type === "placeholder" && clip.accepts === "audio")) return null;
  const full =
    clip.type === "text"
      ? textRect(clip, doc.width, (s) => sizer.measure(clip, s), sizer.measureSpan ? (s, span) => sizer.measureSpan!(clip, s, span) : undefined)
      : clip.type === "placeholder" || clip.type === "nest"
        ? centred(doc) // an empty slot, and a nest's picture, is as large as the frame before its transform
        : clip.type === "shape"
          ? shapeBox(clip) // a shape takes no crop
          : centred(mediaSize(doc, clip, sizer.source(clip)));
  return { full, kept: clip.type === "shape" ? full : cropRect(full, clip.transform.crop) };
}

const centred = ({ width, height }: { width: number; height: number }): LocalRect => ({
  left: -width / 2,
  top: -height / 2,
  right: width / 2,
  bottom: height / 2,
});

// The box an empty slot occupies on the frame, in frame pixels, before its rotation: the whole frame sized by the
// clip's scale and stretch around its position. The canvas overlay draws and hit-tests this box.
export function placeholderBox(clip: PlaceholderClip, frame: FrameSize): { x: number; y: number; w: number; h: number } {
  const t = clip.transform;
  const w = frame.width * t.scale * stretchOf(t);
  const h = frame.height * t.scale;
  return { x: t.x * frame.width - w / 2, y: t.y * frame.height - h / 2, w, h };
}
