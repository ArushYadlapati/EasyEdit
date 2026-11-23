import { applyOps, docDuration, prepareOps, type OpInput, type TimelineDoc } from "@/lib/timeline";

// Exporting a part of a project: the project as it would be if only that part existed, starting at frame 0. The
// export then needs to know nothing about ranges. Made on the page, before the export starts.

export type Span = { from: number; to: number }; // timeline frames, the end not included

export type RangeKind = "all" | "selection" | "playhead";
export const RANGE_LABEL: Record<RangeKind, string> = { all: "Whole project", selection: "Selected clips", playhead: "From the playhead" };

// The part each choice means, or null when it has none: no clip selected, or a playhead at or past the end.
export function spanOf(kind: RangeKind, doc: TimelineDoc, selectedClipIds: readonly string[], playhead: number): Span | null {
  const end = docDuration(doc);
  if (kind === "all") return end > 0 ? { from: 0, to: end } : null;
  if (kind === "playhead") return playhead < end ? { from: Math.max(0, playhead), to: end } : null;
  const picked = new Set(selectedClipIds);
  const clips = doc.tracks.flatMap((track) => track.clips.filter((clip) => picked.has(clip.id)));
  if (clips.length === 0) return null;
  return { from: Math.min(...clips.map((c) => c.start)), to: Math.max(...clips.map((c) => c.start + c.duration)) };
}

// What cutting a clip at the span's edge takes off it, so it does not fade or slide in where it never began.
const NO_WAY_IN = { transitionIn: null, animationIn: null, fadeIn: 0 };
const NO_WAY_OUT = { transitionOut: null, animationOut: null, fadeOut: 0 };

// The doc with only what plays in the span, moved to start at frame 0. Clips outside are dropped; a clip the span
// cuts is trimmed there, keeping the same picture and sound on every frame it still has, and loses its way in or out
// at the cut. Locks are ignored: this is a copy to export, not an edit. The whole project comes back as it is.
export function rangeDoc(doc: TimelineDoc, span: Span): TimelineDoc {
  if (span.from <= 0 && span.to >= docDuration(doc)) return doc;
  const copy = structuredClone(doc);
  for (const track of copy.tracks) track.locked = false;
  const ops: OpInput[] = [];
  for (const track of copy.tracks) {
    // Earliest first, so a clip moved earlier never lands on one still waiting to move.
    for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
      const end = clip.start + clip.duration;
      if (end <= span.from || clip.start >= span.to) {
        ops.push({ op: "remove_clip", clipId: clip.id });
        continue;
      }
      const has = (key: string) => (clip as Record<string, unknown>)[key] !== undefined;
      const without = (keys: Record<string, unknown>) => Object.fromEntries(Object.entries(keys).filter(([key]) => has(key)));
      if (clip.start < span.from) {
        ops.push({ op: "trim_clip", clipId: clip.id, edge: "start", to: span.from });
        const patch = without(NO_WAY_IN);
        if (Object.keys(patch).length > 0) ops.push({ op: "update_clip", clipId: clip.id, patch });
      }
      if (end > span.to) {
        ops.push({ op: "trim_clip", clipId: clip.id, edge: "end", to: span.to });
        const patch = without(NO_WAY_OUT);
        if (Object.keys(patch).length > 0) ops.push({ op: "update_clip", clipId: clip.id, patch });
      }
      const start = Math.max(clip.start, span.from);
      if (span.from > 0) ops.push({ op: "move_clip", clipId: clip.id, start: start - span.from });
    }
  }
  return applyOps(copy, prepareOps(ops)).doc;
}
