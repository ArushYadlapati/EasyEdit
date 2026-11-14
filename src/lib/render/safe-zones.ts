import { safeAreaOf } from "@/lib/timeline/presets";
import type { TimelineDoc } from "@/lib/timeline/types";

export const SAFE_AREA_LABEL = "Safe area";

// The safe area's margins as shares of the frame, for the box drawn over the preview: centred sideways, from its
// top down by its height.
export function safeAreaMargins(doc: Pick<TimelineDoc, "format" | "safeAreas">): { top: number; right: number; bottom: number; left: number } {
  const { top, width, height } = safeAreaOf(doc);
  const side = Number(((1 - width) / 2).toFixed(4));
  return { top, right: side, bottom: Number((1 - top - height).toFixed(4)), left: side };
}
