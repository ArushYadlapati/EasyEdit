import type { Marker, OpInput, TimelineDoc } from "@/lib/timeline";

// Markers on the timeline: named points in time, kept with the project. Pure builders and lookups.

// In time order; markers on one frame keep the order they were added in.
export function sortedMarkers(doc: TimelineDoc): Marker[] {
  return [...(doc.markers ?? [])].sort((a, b) => a.at - b.at);
}

export function markerAt(doc: TimelineDoc, frame: number): Marker | undefined {
  return doc.markers?.find((m) => m.at === frame);
}

// A marker at the frame is taken away; with none there, one is put there. One key does both, like a keyframe's diamond.
export function toggleMarkerOps(doc: TimelineDoc, frame: number): { ops: OpInput[]; added: boolean } {
  const here = markerAt(doc, frame);
  if (here) return { ops: [{ op: "remove_marker", markerId: here.id }], added: false };
  return { ops: [{ op: "add_marker", marker: { at: frame, name: "" } }], added: true };
}

// The frame of the nearest marker before or after the frame, or null.
export function neighbourMarker(doc: TimelineDoc, frame: number, dir: "prev" | "next"): number | null {
  const frames = sortedMarkers(doc).map((m) => m.at);
  if (dir === "next") return frames.find((at) => at > frame) ?? null;
  return frames.findLast((at) => at < frame) ?? null;
}

// What a marker says where it has room for a few words: its name, or "Marker" for one with none.
export function markerLabel(marker: Marker): string {
  return marker.name.trim() || "Marker";
}
