import type { TimelineDoc } from "@/lib/timeline";

export const SNAP_PX = 8; // how close, on screen, a dragged edge must come to a target
export const SECOND_SNAP_MIN_PX = 24; // whole seconds are targets only when one second is at least this wide

// The starts and ends of every clip but the excluded ones, sorted, each once.
export function clipEdges(doc: TimelineDoc, excludeClipIds: string[]): number[] {
  const excluded = new Set(excludeClipIds);
  const edges = new Set<number>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) continue;
      edges.add(clip.start);
      edges.add(clip.start + clip.duration);
    }
  }
  return [...edges].sort((a, b) => a - b);
}

// The edges either side of frame, by binary search over the sorted edges: the last one before it and
// the first one at or after it, when there are any.
function neighbours(edges: number[], frame: number): number[] {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] < frame) lo = mid + 1;
    else hi = mid;
  }
  return edges.slice(Math.max(0, lo - 1), lo + 1);
}

// The frames to add to the candidates so the closest one lands on a target within SNAP_PX, and that
// target; null when none is in reach. On equal distance a clip edge wins over the playhead, and the
// playhead over a whole second. atPress, when given, holds where each candidate was at the press: a
// candidate then snaps only onto a target it is now closer to, so it is never held on a target it
// started on or is moving away from.
export function snap(
  candidates: number[],
  ctx: { edges: number[]; playhead: number; fps: number; zoom: number },
  atPress?: number[],
): { delta: number; guide: number } | null {
  const reach = SNAP_PX / ctx.zoom;
  const seconds = ctx.fps * ctx.zoom >= SECOND_SNAP_MIN_PX;
  let best: { delta: number; guide: number } | null = null;
  let bestDistance = Infinity;
  let bestRank = Infinity;
  for (const [i, candidate] of candidates.entries()) {
    // Each target with its rank: clip edges 0, the playhead 1, the whole second 2.
    const targets: [number, number][] = neighbours(ctx.edges, candidate).map((edge) => [0, edge]);
    targets.push([1, ctx.playhead]);
    if (seconds) targets.push([2, Math.round(candidate / ctx.fps) * ctx.fps]);
    for (const [rank, target] of targets) {
      const distance = Math.abs(target - candidate);
      if (distance > reach || distance > bestDistance || (distance === bestDistance && rank >= bestRank)) continue;
      if (atPress && Math.abs(target - atPress[i]) <= distance) continue;
      best = { delta: target - candidate, guide: target };
      bestDistance = distance;
      bestRank = rank;
    }
  }
  return best;
}
