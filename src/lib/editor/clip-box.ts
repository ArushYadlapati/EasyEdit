import { cropRect, mediaSize, type LocalRect } from "@/lib/render/compositor";
import { textRect } from "@/lib/render/text-layout";
import type { Clip, MediaClip, TextClip, TimelineDoc } from "@/lib/timeline";

// What a clip's box is measured with: the picture size of a video or image (null when it is not known, so the
// placeholder's whole frame), and the width of a line of text in the clip's font.
export type Sizer = {
  source(clip: MediaClip): { width: number; height: number } | null;
  measure(clip: TextClip, s: string): number;
};

// A clip's box as the preview draws it, from its centre, before scale, stretch and rotation: the whole picture or
// text box, and the part the crop keeps. Audio has none.
export function clipRects(doc: TimelineDoc, clip: Clip, sizer: Sizer): { full: LocalRect; kept: LocalRect } | null {
  if (clip.type === "audio") return null;
  const full = clip.type === "text" ? textRect(clip, doc.width, (s) => sizer.measure(clip, s)) : centred(mediaSize(doc, clip, sizer.source(clip)));
  return { full, kept: cropRect(full, clip.transform.crop) };
}

const centred = ({ width, height }: { width: number; height: number }): LocalRect => ({
  left: -width / 2,
  top: -height / 2,
  right: width / 2,
  bottom: height / 2,
});
