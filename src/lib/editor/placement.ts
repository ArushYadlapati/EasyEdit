import { LIMITS } from "@/lib/limits";
import { trackTakes, type Clip, type OpInput, type TimelineDoc, type Track, type TrackKind } from "@/lib/timeline";
import { displayRows } from "./geometry";

export const TRACK_KIND_LABEL: Record<TrackKind, string> = {
  video: "Video",
  overlay: "Overlay",
  text: "Text",
  caption: "Captions",
  audio: "Audio",
  shape: "Shapes",
};

// "Captions" for a caption track, else "<label> <n>" with the smallest n no track name uses.
export function nextTrackName(doc: TimelineDoc, kind: TrackKind, taken: string[] = []): string {
  if (kind === "caption") return TRACK_KIND_LABEL.caption;
  const used = new Set([...doc.tracks.map((t) => t.name), ...taken]);
  let n = 1;
  while (used.has(`${TRACK_KIND_LABEL[kind]} ${n}`)) n++;
  return `${TRACK_KIND_LABEL[kind]} ${n}`;
}

// Where a new track of this kind goes in doc.tracks: right after the last track of its kind, so it
// sits just in front of its own kind and behind everything that was in front of it. A kind with no
// track yet goes at the end, except the first shapes track: it goes just behind the lowest text track, so shapes draw
// over the footage and under text (a filled box can sit behind a title), or with no text track just in front of the
// top video or overlay track.
export function newTrackIndex(doc: { tracks: { kind: TrackKind }[] }, kind: TrackKind): number {
  const last = doc.tracks.findLastIndex((t) => t.kind === kind);
  if (last >= 0) return last + 1;
  if (kind === "shape") {
    const text = doc.tracks.findIndex((t) => t.kind === "text");
    if (text >= 0) return text;
    const picture = doc.tracks.findLastIndex((t) => t.kind === "video" || t.kind === "overlay");
    if (picture >= 0) return picture + 1;
  }
  return doc.tracks.length;
}

export function homeKind(type: Clip["type"]): TrackKind {
  if (type === "text") return "text";
  if (type === "audio") return "audio";
  if (type === "shape") return "shape";
  if (type === "caption") return "caption";
  return "video";
}

// The kind of track an existing clip belongs on: an empty slot by what it accepts, any other clip by its type.
export function homeKindOf(clip: Clip): TrackKind {
  return homeKind(clip.type === "placeholder" ? (clip.accepts === "audio" ? "audio" : "video") : clip.type);
}

type Span = { start: number; duration: number };

function isFreeAmong(clips: Span[], start: number, duration: number): boolean {
  return clips.every((c) => start >= c.start + c.duration || start + duration <= c.start);
}

// Touching another clip counts as free.
export function isFree(track: Track, start: number, duration: number): boolean {
  return isFreeAmong(track.clips, start, duration);
}

// clip.id is ignored; trackId is the track the clip would like. kind, when given, is the only kind of track it may go
// on (a logo on an overlay, never on a free video track), and the kind of a track made for it.
export type PlaceItem = { clip: Clip; trackId: string | null; kind?: TrackKind };
export type Placement = { ok: true; ops: OpInput[]; clipIds: string[] } | { ok: false };

// Where a group of clips goes: the wished track, then tracks of the group's own kind, then any
// other track that accepts it, each in display order. Without a fit the group gets a new track.
// Only chooses where to try: applyOps still decides whether the result is valid.
export function placeClips(doc: TimelineDoc, items: PlaceItem[], genId: () => string): Placement {
  const byId = new Map(doc.tracks.map((t) => [t.id, t]));
  const groups = new Map<string, PlaceItem[]>();
  for (const item of items) {
    const wished = item.trackId !== null && byId.has(item.trackId) ? item.trackId : null;
    const key = wished !== null ? `track:${wished}` : item.kind ? `only:${item.kind}` : `kind:${homeKindOf(item.clip)}`;
    groups.set(key, [...(groups.get(key) ?? []), { clip: item.clip, trackId: wished, kind: item.kind }]);
  }

  const placed = new Map<string, Span[]>(); // clips added to existing tracks earlier in this call
  const rows = displayRows(doc);
  const ops: OpInput[] = [];
  const clipIds: string[] = [];
  let newTracks = 0;
  const newNames: string[] = [];
  const kinds = doc.tracks.map((t) => ({ kind: t.kind })); // doc.tracks' kinds with the new tracks put in

  // Clips of one group that overlap each other cannot share a track: they are dealt, in order,
  // into layers, and each layer is placed like a group of its own.
  const layers = [...groups.values()].flatMap((group) => {
    const out: PlaceItem[][] = [];
    for (const item of group) {
      const layer = out.find((l) => isFreeAmong(l.map((i) => i.clip), item.clip.start, item.clip.duration));
      if (layer) layer.push(item);
      else out.push([item]);
    }
    return out;
  });

  for (const group of layers) {
    const wished = group[0].trackId !== null ? byId.get(group[0].trackId) : undefined;
    const only = wished ? undefined : group[0].kind;
    const kind = wished?.kind ?? only ?? homeKindOf(group[0].clip);

    const fits = (track: Track): boolean => {
      if (track.locked) return false;
      if (!group.every((g) => trackTakes(track.kind, g.clip))) return false;
      const taken: Span[] = [...track.clips, ...(placed.get(track.id) ?? [])];
      for (const { clip } of group) {
        if (!isFreeAmong(taken, clip.start, clip.duration)) return false;
        taken.push(clip);
      }
      return true;
    };

    const candidates: Track[] = [
      ...(wished ? [wished] : []),
      ...rows.filter((t) => t.kind === kind),
      ...(only ? [] : rows.filter((t) => t.kind !== kind)),
    ];
    const target = candidates.find(fits);

    let trackId: string;
    if (target) {
      trackId = target.id;
    } else {
      if (doc.tracks.length + newTracks + 1 > LIMITS.tracksPerProject) return { ok: false };
      const newKind = only ?? homeKindOf(group[0].clip);
      // A project has one Captions track: captions with no room on it have nowhere to go.
      if (newKind === "caption" && (doc.tracks.some((t) => t.kind === "caption") || kinds.some((t) => t.kind === "caption"))) return { ok: false };
      const name = nextTrackName(doc, newKind, newNames);
      newNames.push(name);
      newTracks++;
      trackId = genId();
      const index = newTrackIndex({ tracks: kinds }, newKind);
      kinds.splice(index, 0, { kind: newKind });
      ops.push({ op: "add_track", track: { id: trackId, kind: newKind, name }, index });
    }

    const spans = placed.get(trackId) ?? [];
    for (const { clip } of group) {
      const id = genId();
      ops.push({ op: "add_clip", trackId, clip: { ...clip, id } });
      clipIds.push(id);
      spans.push(clip);
    }
    placed.set(trackId, spans);
  }
  return { ok: true, ops, clipIds };
}
