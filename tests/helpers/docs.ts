import { createEmptyDoc, type FormatId, type FrameSize, type TimelineDoc } from "@/lib/timeline";

// A new project's doc with a Captions track as its third row: v1, t1, cap, a1. New projects start without one, but a
// project can still have one, and many tests are written against this four-row layout.
export function docWithCaptions(format: FormatId, size?: FrameSize): TimelineDoc {
  const d = createEmptyDoc(format, size);
  d.tracks.splice(2, 0, { id: "cap", kind: "caption", name: "Captions", muted: false, hidden: false, locked: false, clips: [] });
  return d;
}
