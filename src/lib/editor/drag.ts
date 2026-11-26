import type { OpInput, TimelineDoc } from "@/lib/timeline";
import { isMediaClip } from "@/lib/timeline";
import { moveOps } from "./commands";
import { trimBounds, trimReach } from "./media-clips";
import { clipEdges, snap } from "./snap";

// Moving and trimming clips with the pointer. A drag records where its clips were when it began;
// resolveDrag turns a pointer position into ops against the current document. Whether those ops
// may be applied is left to applyOps, through the store's setGesture.

// minStart and maxEnd: how far a trim may take the clip's edges before its media runs out, when that is known.
// headRoom: how many frames a start trim could add at the clip's head if the timeline had room for them, when known.
export type DragOrigin = { clipId: string; start: number; duration: number; trackId: string; minStart?: number; maxEnd?: number; headRoom?: number };

// reach: for a slide, how far the neighbours' media lets the cuts go: the latest end of the clip before the dragged
// one and the earliest start of the clip after it, each when known.
export type Drag =
  | { type: "move"; grabFrame: number; primary: string; origins: DragOrigin[]; reach?: { prevMaxEnd?: number; nextMinStart?: number } }
  | { type: "trim"; edge: "start" | "end"; grabFrame: number; primary: string; origins: DragOrigin[] };

// What a drag on a clip's edge does to the clips around it. trim: nothing; a gap opens or the clip stops at its
// neighbour. ripple: every later clip on the track moves with the edge, so no gap opens and nothing is covered. roll:
// the cut between the clip and the one touching that edge moves, one clip growing as the other shrinks. slide is for
// dragging a clip itself: it moves along its track between the clips touching it, the one before ending later or
// sooner and the one after starting later or sooner, so the clip keeps its footage and nothing around it moves.
export type TrimMode = "trim" | "ripple" | "roll" | "slide";
export const TRIM_MODES: readonly TrimMode[] = ["trim", "ripple", "roll", "slide"];
export const TRIM_MODE_LABEL: Record<TrimMode, string> = { trim: "Trim", ripple: "Ripple trim", roll: "Roll", slide: "Slide" };

export type DragInput = { frame: number; rowTrackId: string | null; playhead: number; zoom: number; snapping: boolean; trimMode?: TrimMode };

// Where a dragged clip would be for this pointer position, drawn when the drop is not allowed.
export type DragGhost = { clipId: string; trackId: string; start: number; duration: number };

export type DragResult = { ops: OpInput[]; guide: number | null; label: "move" | "trim" | "ripple trim" | "roll" | "slide"; ghost: DragGhost[] };

// The clips with these ids on unlocked tracks, in document order.
function originsOf(doc: TimelineDoc, ids: Set<string>): DragOrigin[] {
  const origins: DragOrigin[] = [];
  for (const track of doc.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (ids.has(clip.id)) origins.push({ clipId: clip.id, start: clip.start, duration: clip.duration, trackId: track.id });
    }
  }
  return origins;
}

// The selection moves when it holds the grabbed clip; otherwise the grabbed clip moves alone. Null
// when that clip is missing or on a locked track.
// lengthOf gives the length of an asset in this document's frames, when it is known: a slide then stops where a
// neighbour's media runs out.
export function beginMove(doc: TimelineDoc, clipId: string, selection: string[], grabFrame: number, lengthOf?: (assetId: string) => number | undefined): Drag | null {
  const origins = originsOf(doc, new Set(selection.includes(clipId) ? selection : [clipId]));
  const grabbed = origins.find((o) => o.clipId === clipId);
  if (!grabbed) return null;
  const drag: Drag = { type: "move", grabFrame, primary: clipId, origins };
  if (origins.length === 1 && lengthOf) {
    const { prev, next } = touchingClips(doc, grabbed);
    const bounds = (clip: typeof prev) => (clip && isMediaClip(clip) ? trimBounds(clip, lengthOf(clip.assetId)) : undefined);
    drag.reach = { prevMaxEnd: bounds(prev)?.maxEnd, nextMinStart: bounds(next)?.minStart };
  }
  return drag;
}

// The clips on a clip's own track that end where it starts and start where it ends.
function touchingClips(doc: TimelineDoc, at: { clipId: string; trackId: string; start: number; duration: number }) {
  const clips = doc.tracks.find((t) => t.id === at.trackId)?.clips ?? [];
  return {
    prev: clips.find((c) => c.id !== at.clipId && c.start + c.duration === at.start),
    next: clips.find((c) => c.id !== at.clipId && c.start === at.start + at.duration),
    others: clips.filter((c) => c.id !== at.clipId),
  };
}

// A slide of one clip by delta frames, or null when it has no clip touching it (it is then moved as usual). Each
// neighbour keeps a frame at least and stays inside its media; a side with no neighbour stops at the next clip.
function slide(doc: TimelineDoc, drag: Extract<Drag, { type: "move" }>, primary: DragOrigin, wanted: number): { ops: OpInput[]; delta: number } | null {
  const { prev, next, others } = touchingClips(doc, primary);
  if (!prev && !next) return null;
  const end = primary.start + primary.duration;
  const before = Math.max(0, ...others.filter((c) => c.start + c.duration <= primary.start).map((c) => c.start + c.duration));
  const after = Math.min(Infinity, ...others.filter((c) => c.start >= end).map((c) => c.start));
  const least = Math.max(prev ? prev.start + 1 - primary.start : before - primary.start, next ? (drag.reach?.nextMinStart ?? -Infinity) - end : -Infinity);
  const most = Math.min(next ? next.start + next.duration - 1 - end : after - end, prev ? (drag.reach?.prevMaxEnd ?? Infinity) - primary.start : Infinity);
  const delta = Math.min(most, Math.max(least, wanted));
  if (delta === 0 || least > most) return { ops: [], delta: 0 };
  const move: OpInput = { op: "move_clip", clipId: primary.clipId, start: primary.start + delta };
  const tail: OpInput[] = prev ? [{ op: "trim_clip", clipId: prev.id, edge: "end", to: primary.start + delta }] : [];
  const head: OpInput[] = next ? [{ op: "trim_clip", clipId: next.id, edge: "start", to: end + delta }] : [];
  // The neighbour that shrinks goes first and the one that grows last, so no two clips overlap on the way.
  return { ops: delta > 0 ? [...head, move, ...tail] : [...tail, move, ...head], delta };
}

// lengthOf gives the length of an asset in this document's frames, when it is known.
export function beginTrim(
  doc: TimelineDoc,
  clipId: string,
  edge: "start" | "end",
  grabFrame: number,
  lengthOf?: (assetId: string) => number | undefined,
): Drag | null {
  const origins = originsOf(doc, new Set([clipId]));
  if (origins.length === 0) return null;
  const clip = doc.tracks.find((t) => t.id === origins[0].trackId)?.clips.find((c) => c.id === clipId);
  const length = clip && isMediaClip(clip) && lengthOf ? lengthOf(clip.assetId) : undefined;
  const bounds = clip && isMediaClip(clip) ? trimBounds(clip, length) : undefined;
  const headRoom = clip && isMediaClip(clip) ? trimReach(clip, length)?.back : undefined;
  return { type: "trim", edge, grabFrame, primary: clipId, origins: [bounds ? { ...origins[0], ...bounds, headRoom } : origins[0]] };
}

function existingClipIds(doc: TimelineDoc): Set<string> {
  const ids = new Set<string>();
  for (const track of doc.tracks) for (const clip of track.clips) ids.add(clip.id);
  return ids;
}

// Null when the grabbed clip is gone. Other dragged clips that are gone are left out.
export function resolveDrag(doc: TimelineDoc, drag: Drag, input: DragInput): DragResult | null {
  const existing = existingClipIds(doc);
  const origins = drag.origins.filter((o) => existing.has(o.clipId));
  const primary = origins.find((o) => o.clipId === drag.primary);
  if (!primary) return null;
  // atPress: where the candidates were when the drag began, so an edge only snaps onto a target it is coming closer to.
  const snapTo = (candidates: number[], atPress: number[]) =>
    input.snapping
      ? snap(candidates, { edges: clipEdges(doc, origins.map((o) => o.clipId)), playhead: input.playhead, fps: doc.fps, zoom: input.zoom }, atPress)
      : null;
  let delta = Math.round(input.frame - drag.grabFrame);

  if (drag.type === "move") {
    const snapped = snapTo([primary.start + delta, primary.start + primary.duration + delta], [primary.start, primary.start + primary.duration]);
    if (snapped) delta += snapped.delta;
    const slid = input.trimMode === "slide" && origins.length === 1 ? slide(doc, drag, primary, delta) : null;
    if (slid) {
      return {
        ops: slid.ops,
        guide: snapped && slid.delta === delta ? snapped.guide : null,
        label: "slide",
        ghost: [{ clipId: primary.clipId, trackId: primary.trackId, start: primary.start + slid.delta, duration: primary.duration }],
      };
    }
    const tracks = new Set(origins.map((o) => o.trackId));
    const toTrack = tracks.size === 1 && input.rowTrackId !== null && !tracks.has(input.rowTrackId) ? input.rowTrackId : undefined;
    const ops = moveOps(origins.map(({ clipId, start }) => ({ clipId, start })), delta, toTrack);
    const placed = new Map<string, { start: number; trackId?: string }>();
    for (const op of ops) if (op.op === "move_clip") placed.set(op.clipId, op);
    const ghost = origins.map(({ clipId, trackId, start, duration }) => {
      const at = placed.get(clipId);
      return { clipId, trackId: at?.trackId ?? trackId, start: at?.start ?? start, duration };
    });
    // moveOps raises a delta that would put a clip before frame 0; a target it then misses is not shown.
    const used = (placed.get(primary.clipId)?.start ?? primary.start) - primary.start;
    const guide = snapped && used === delta ? snapped.guide : null;
    return { ops, guide, label: "move", ghost };
  }

  const end = primary.start + primary.duration;
  const from = drag.edge === "start" ? primary.start : end;
  const snapped = snapTo([from + delta], [from]);
  const wanted = from + delta + (snapped?.delta ?? 0);
  const mode = input.trimMode ?? "trim";
  const track = doc.tracks.find((t) => t.id === primary.trackId);
  // Roll needs a clip touching the dragged edge; without one the edge is trimmed as usual.
  const touching = mode !== "roll" ? undefined : track?.clips.find((c) => c.id !== primary.clipId && (drag.edge === "end" ? c.start === end : c.start + c.duration === primary.start));
  let to =
    drag.edge === "start"
      ? Math.min(Math.max(wanted, primary.minStart ?? 0), end - 1)
      : Math.max(Math.min(wanted, primary.maxEnd ?? wanted), primary.start + 1);
  // The clip that gives way keeps a frame at least.
  if (touching) to = drag.edge === "end" ? Math.min(to, touching.start + touching.duration - 1) : Math.max(to, touching.start + 1);
  if (touching && to !== from) {
    const mine: OpInput = { op: "trim_clip", clipId: primary.clipId, edge: drag.edge, to };
    const theirs: OpInput = { op: "trim_clip", clipId: touching.id, edge: drag.edge === "end" ? "start" : "end", to };
    // The clip that shrinks goes first, so the two never overlap on the way.
    const mineGrows = drag.edge === "end" ? to > from : to < from;
    const rolled = drag.edge === "end" ? { start: primary.start, duration: to - primary.start } : { start: to, duration: end - to };
    return {
      ops: mineGrows ? [theirs, mine] : [mine, theirs],
      guide: snapped && to === wanted ? snapped.guide : null,
      label: "roll",
      ghost: [{ clipId: primary.clipId, trackId: primary.trackId, ...rolled }],
    };
  }
  if (mode === "ripple" && track && (to !== from || drag.edge === "start")) {
    // The clips after this one on its track, as they are now, earliest first.
    const later = track.clips.filter((c) => c.id !== primary.clipId && c.start >= end).sort((a, b) => a.start - b.start);
    const shift = (by: number): OpInput[] => {
      const moves = later.map((c): OpInput => ({ op: "move_clip", clipId: c.id, start: c.start + by }));
      // Moving later, the last clip goes first; moving earlier, the first one does: nothing ever lands on a neighbour.
      return by > 0 ? moves.reverse() : moves;
    };
    const guide = snapped && to === wanted ? snapped.guide : null;
    if (drag.edge === "end") {
      if (to === from) return { ops: [], guide: null, label: "ripple trim", ghost: [{ clipId: primary.clipId, trackId: primary.trackId, start: primary.start, duration: primary.duration }] };
      const by = to - end;
      const trim: OpInput = { op: "trim_clip", clipId: primary.clipId, edge: "end", to };
      return { ops: by > 0 ? [...shift(by), trim] : [trim, ...shift(by)], guide, label: "ripple trim", ghost: [{ clipId: primary.clipId, trackId: primary.trackId, start: primary.start, duration: to - primary.start }] };
    }
    // A start edge: the clip keeps its place and loses or gains footage at its head, and what follows closes up or
    // makes room. The head grows as far as its footage goes, whatever sits before the clip: it does not move that way.
    const headTo = Math.min(Math.max(wanted, primary.start - (primary.headRoom ?? Infinity)), end - 1);
    const cut = headTo - primary.start; // above 0: frames taken off the head
    if (cut === 0) return { ops: [], guide: null, label: "ripple trim", ghost: [{ clipId: primary.clipId, trackId: primary.trackId, start: primary.start, duration: primary.duration }] };
    const ghost = [{ clipId: primary.clipId, trackId: primary.trackId, start: primary.start, duration: primary.duration - cut }];
    if (cut > 0) {
      return {
        ops: [{ op: "trim_clip", clipId: primary.clipId, edge: "start", to: headTo }, { op: "move_clip", clipId: primary.clipId, start: primary.start }, ...shift(-cut)],
        guide,
        label: "ripple trim",
        ghost,
      };
    }
    return {
      ops: [...shift(-cut), { op: "move_clip", clipId: primary.clipId, start: primary.start - cut }, { op: "trim_clip", clipId: primary.clipId, edge: "start", to: primary.start }],
      guide,
      label: "ripple trim",
      ghost,
    };
  }
  // A snap target the edge cannot reach, at either end of the clip's media too, is not shown.
  const guide = snapped && to === wanted ? snapped.guide : null;
  const ghost = [
    drag.edge === "start"
      ? { clipId: primary.clipId, trackId: primary.trackId, start: to, duration: end - to }
      : { clipId: primary.clipId, trackId: primary.trackId, start: primary.start, duration: to - primary.start },
  ];
  const ops: OpInput[] = to === from ? [] : [{ op: "trim_clip", clipId: primary.clipId, edge: drag.edge, to }];
  return { ops, guide, label: "trim", ghost };
}
