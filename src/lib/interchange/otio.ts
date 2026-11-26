import { baseName, type SeqClip, type Sequence } from "./model";

// OpenTimelineIO: a JSON timeline that DaVinci Resolve and newer tools read and write. A timeline is a stack of
// tracks; a track is a row of clips, gaps and transitions, each as long as it says, placed one after another. Every
// time is a value at a rate, so each is turned into seconds on its own.

export type OtioResult = { ok: true; sequence: Sequence } | { ok: false; message: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);
const schemaOf = (v: Json): string => String(v.OTIO_SCHEMA ?? "").split(".")[0];

function secondsOf(time: unknown): number | null {
  if (!isObject(time)) return null;
  const value = Number(time.value);
  const rate = Number(time.rate);
  return Number.isFinite(value) && Number.isFinite(rate) && rate > 0 ? value / rate : null;
}
function rangeOf(range: unknown): { start: number; duration: number } | null {
  if (!isObject(range)) return null;
  const duration = secondsOf(range.duration);
  return duration === null ? null : { start: secondsOf(range.start_time) ?? 0, duration };
}

export function readOtio(text: string): OtioResult {
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, message: "That file is not an OpenTimelineIO timeline (it is not JSON)." };
  }
  if (!isObject(root) || schemaOf(root) !== "Timeline") return { ok: false, message: "That file is not an OpenTimelineIO timeline." };
  const stack = isObject(root.tracks) ? root.tracks : null;
  const clips: SeqClip[] = [];
  const markers: { at: number; name: string }[] = [];
  const notes: string[] = [];
  let fps: number | null = null;
  let nested = 0;
  let videoTracks = 0;
  let audioTracks = 0;
  const seeRate = (time: unknown) => {
    if (fps === null && isObject(time) && Number(time.rate) > 0) fps = Math.round(Number(time.rate));
  };
  const markersOf = (owner: Json, offset: number, sourceStart: number) => {
    for (const marker of list(owner.markers)) {
      const range = rangeOf(marker.marked_range);
      if (range) markers.push({ at: Math.max(0, offset + range.start - sourceStart), name: String(marker.name ?? "") });
    }
  };

  for (const track of list(stack?.children)) {
    if (schemaOf(track) !== "Track") {
      nested++;
      continue;
    }
    const kind = String(track.kind ?? "Video").toLowerCase() === "audio" ? "audio" : "video";
    const index = kind === "video" ? videoTracks++ : audioTracks++;
    let at = 0;
    let dissolve: number | null = null;
    markersOf(track, 0, 0);
    for (const item of list(track.children)) {
      const schema = schemaOf(item);
      if (schema === "Transition") {
        // A transition overlaps its neighbours and takes no room of its own.
        dissolve = (secondsOf(item.in_offset) ?? 0) + (secondsOf(item.out_offset) ?? 0);
        continue;
      }
      const reference = isObject(item.media_references) ? (item.media_references as Json)[String(item.active_media_reference_key ?? "DEFAULT_MEDIA")] : item.media_reference;
      const range = rangeOf(item.source_range) ?? (isObject(reference) ? rangeOf(reference.available_range) : null);
      if (isObject(item.source_range)) seeRate(item.source_range.duration);
      if (!range || range.duration <= 0) continue;
      if (schema === "Clip") {
        const url = isObject(reference) ? String(reference.target_url ?? "") : "";
        // A reference's own range says where the file's clock starts (often not zero for camera files).
        const fileStart = isObject(reference) ? (rangeOf(reference.available_range)?.start ?? 0) : 0;
        const warp = list(item.effects).find((e) => schemaOf(e) === "LinearTimeWarp");
        const scalar = warp ? Number(warp.time_scalar) : 1;
        const clip: SeqClip = {
          name: String(item.name ?? "") || (url ? baseName(url) : "Clip"),
          fileName: url ? baseName(url) : String(item.name ?? "") || null,
          kind,
          track: index,
          start: at,
          duration: range.duration,
          in: Math.max(0, range.start - fileStart),
          speed: Number.isFinite(scalar) && scalar !== 0 ? scalar : 1,
        };
        // The format has no word for a level or an opacity. Files written here carry them in a note of their own.
        const own = isObject(item.metadata) && isObject(item.metadata.easyedit) ? item.metadata.easyedit : null;
        if (own && typeof own.volume === "number" && own.volume >= 0) clip.volume = own.volume;
        if (own && typeof own.opacity === "number" && kind === "video") clip.opacity = Math.min(1, Math.max(0, own.opacity));
        if (dissolve !== null && dissolve > 0 && kind === "video" && clips.some((c) => c.kind === "video" && c.track === index)) clip.dissolveIn = dissolve;
        if (item.enabled !== false) clips.push(clip);
        markersOf(item, at, range.start);
      } else if (schema !== "Gap") nested++;
      at += range.duration;
      dissolve = null;
    }
  }
  if (stack) markersOf(stack, 0, 0);
  if (clips.length === 0) return { ok: false, message: "That timeline has no clips in it." };
  if (nested > 0) notes.push(`${nested} nested ${nested === 1 ? "timeline was" : "timelines were"} left out: flatten them before exporting.`);
  return { ok: true, sequence: { name: String(root.name ?? "") || "Timeline", fps, width: null, height: null, clips, markers, notes } };
}

// A sequence as OpenTimelineIO at a frame rate. A video clip's own sound is written as a clip on an audio track of
// its own, as these files list sound apart from picture.
export function writeOtio(sequence: Sequence, fps: number): string {
  const time = (seconds: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: fps, value: Math.round(seconds * fps) });
  const range = (start: number, duration: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: time(start), duration: time(duration) });
  const trackOf = (name: string, kind: "Video" | "Audio", clips: SeqClip[]) => {
    const children: Json[] = [];
    let at = 0;
    for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
      const gap = clip.start - at;
      if (Math.round(gap * fps) > 0) children.push({ OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, gap), effects: [], markers: [], metadata: {} });
      if (kind === "Video" && clip.dissolveIn && clip.dissolveIn > 0 && children.length > 0) {
        children.push({ OTIO_SCHEMA: "Transition.1", name: "Cross Dissolve", transition_type: "SMPTE_Dissolve", in_offset: time(0), out_offset: time(clip.dissolveIn), metadata: {} });
      }
      const fileName = clip.fileName ?? clip.name;
      children.push({
        OTIO_SCHEMA: "Clip.1",
        name: clip.name,
        source_range: range(clip.in, clip.duration),
        effects: clip.speed !== 1 && clip.speed !== 0 ? [{ OTIO_SCHEMA: "LinearTimeWarp.1", name: "", effect_name: "LinearTimeWarp", time_scalar: clip.speed, metadata: {} }] : [],
        markers: [],
        // A level and an opacity have no place of their own in this format: other programs pass over this note.
        metadata: clip.volume !== undefined || clip.opacity !== undefined ? { easyedit: { ...(clip.volume !== undefined && { volume: clip.volume }), ...(clip.opacity !== undefined && { opacity: clip.opacity }) } } : {},
        media_reference: { OTIO_SCHEMA: "ExternalReference.1", name: fileName, target_url: encodeURIComponent(fileName), available_range: null, metadata: {} },
      });
      at = Math.max(at, clip.start) + clip.duration;
    }
    return { OTIO_SCHEMA: "Track.1", name, kind, children, source_range: null, effects: [], markers: [], metadata: {} };
  };
  const byTrack = (kind: "video" | "audio") => {
    const tracks: SeqClip[][] = [];
    for (const clip of sequence.clips) if (clip.kind === kind) (tracks[clip.track] ??= []).push(clip);
    return Array.from(tracks, (t) => t ?? []);
  };
  const video = byTrack("video");
  const sounding = video.map((clips) => clips.filter((c) => c.sound)).filter((clips) => clips.length > 0);
  const audio = [...sounding, ...byTrack("audio")];
  const timeline = {
    OTIO_SCHEMA: "Timeline.1",
    name: sequence.name,
    global_start_time: null,
    metadata: {},
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      source_range: null,
      effects: [],
      metadata: {},
      markers: sequence.markers.map((m) => ({ OTIO_SCHEMA: "Marker.2", name: m.name, color: "RED", marked_range: range(m.at, 0), metadata: {} })),
      children: [...video.map((clips, i) => trackOf(`V${i + 1}`, "Video", clips)), ...audio.map((clips, i) => trackOf(`A${i + 1}`, "Audio", clips))],
    },
  };
  return `${JSON.stringify(timeline, null, 1)}\n`;
}
