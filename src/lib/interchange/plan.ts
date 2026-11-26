import { mediaLengthFrames } from "@/lib/editor/media-clips";
import { nextTrackName } from "@/lib/editor/placement";
import { LIMITS } from "@/lib/limits";
import type { AssetKind } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, VOLUME_MAX, fitsMedia, type OpInput, type TimelineDoc, type Track } from "@/lib/timeline";
import { readEdl, writeEdl } from "./edl";
import { readFcp7, writeFcp7 } from "./fcp7";
import { formatOf, type InterchangeFormat, type SeqClip, type Sequence } from "./model";
import { readOtio, writeOtio } from "./otio";

// Between a timeline from another editor and this project: reading one in as clips, and writing this project out.
// A clip is matched to the library by its file's name, since a name is all the other program gives. A clip whose file
// is not in the library becomes an empty slot of the same length that says which file it wants, so the cut is whole
// from the start and the files can follow.

// What the library knows of a file, as far as matching and cutting need.
export type LibraryFile = { id: string; kind: AssetKind; name: string; fileName: string; durationMs: number | null; hasAudio: boolean };

export type ReadResult = { ok: true; format: InterchangeFormat; sequence: Sequence } | { ok: false; message: string };

// fps: the project's, which an EDL is read at since it has none of its own.
export function readTimeline(fileName: string, text: string, fps: number): ReadResult {
  const format = formatOf(fileName, text);
  if (!format) return { ok: false, message: "That is not a timeline this can read. Export a Final Cut Pro 7 XML, an EDL or an OpenTimelineIO file." };
  const read = format === "fcp7" ? readFcp7(text) : format === "otio" ? readOtio(text) : readEdl(text, fps);
  return read.ok ? { ok: true, format, sequence: read.sequence } : read;
}

const stem = (name: string) => name.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, "").trim();

// The library's file for a name from another program: the same file name, else the same name without its ending
// (a proxy or a re-encoded copy keeps the name and changes the ending). Null when none or more than one fits.
export function matchFile(fileName: string | null, files: readonly LibraryFile[]): LibraryFile | null {
  if (!fileName) return null;
  const wanted = fileName.toLowerCase().trim();
  const exact = files.filter((f) => f.fileName.toLowerCase() === wanted || f.name.toLowerCase() === wanted);
  if (exact.length > 0) return exact[0];
  const loose = files.filter((f) => stem(f.fileName) === stem(wanted) || stem(f.name) === stem(wanted));
  return loose.length === 1 ? loose[0] : null;
}

// One frame, in seconds, at a rate: two times this near are the same moment.
const near = (a: number, b: number, fps: number) => Math.abs(a - b) < 0.75 / fps;

// The sequence with each video clip's own sound folded into it. Formats that list sound apart from picture give a
// video clip and, on the audio tracks, the same file at the same moment (twice, for a stereo pair): those audio clips
// are dropped and the video clip plays its sound, at their level. A video clip with no such partner is silent, when
// the format lists sound at all. Audio tracks left empty close up.
export function foldSound(sequence: Sequence, fps: number): SeqClip[] {
  const video = sequence.clips.filter((c) => c.kind === "video").map((c) => ({ ...c }));
  const audio = sequence.clips.filter((c) => c.kind === "audio");
  const sameCut = (a: SeqClip, b: SeqClip) => !!a.fileName && a.fileName === b.fileName && near(a.start, b.start, fps) && near(a.duration, b.duration, fps) && near(a.in, b.in, fps);
  const kept: SeqClip[] = [];
  for (const clip of audio) {
    const picture = video.find((v) => sameCut(v, clip));
    if (picture) {
      picture.sound = true;
      if (clip.volume !== undefined) picture.volume = clip.volume;
      continue;
    }
    if (kept.some((k) => k.track !== clip.track && sameCut(k, clip))) continue; // the other side of a stereo pair
    kept.push({ ...clip });
  }
  // A format that marks a video clip's sound itself (an EDL) has said so already; otherwise silence is the default
  // once the file lists any sound at all.
  const listsSound = audio.length > 0 || video.some((v) => v.sound !== undefined);
  for (const v of video) if (v.sound === undefined) v.sound = !listsSound;
  const tracks = [...new Set(kept.map((c) => c.track))].sort((a, b) => a - b);
  for (const clip of kept) clip.track = tracks.indexOf(clip.track);
  const pictureTracks = [...new Set(video.map((c) => c.track))].sort((a, b) => a - b);
  for (const clip of video) clip.track = pictureTracks.indexOf(clip.track);
  return [...video, ...kept];
}

export type ImportSummary = {
  clips: number; // clips that went in, slots included
  matched: number; // of those, with their file found
  missing: string[]; // the files not in the library, each once
  videoTracks: number;
  audioTracks: number;
  markers: number;
  notes: string[];
};
export type ImportPlan = { ok: true; ops: OpInput[]; summary: ImportSummary } | { ok: false; message: string };

// A slot's name from a file's: lower-case letters, digits and underscores, starting with a letter, not yet taken.
function slotName(fileName: string, taken: Set<string>): string {
  const plain = stem(fileName).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const base = (/^[a-z]/.test(plain) ? plain : `clip_${plain}`).slice(0, 34).replace(/_+$/, "") || "clip";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

// The ops that bring a sequence into the project, as one change. Its tracks keep their order: each goes onto an
// empty track of the project that takes it, lowest first, and the rest get new tracks (picture tracks in front of
// the project's own pictures and behind its text, audio tracks last). Everything starts where it did, from frame 0.
// ids: a new id each call, for the tracks made.
export function importPlan(doc: TimelineDoc, sequence: Sequence, files: readonly LibraryFile[], ids: () => string): ImportPlan {
  const fps = doc.fps;
  const frames = (seconds: number) => Math.round(seconds * fps);
  const notes = [...sequence.notes];
  const taken = new Set(doc.tracks.flatMap((t) => t.clips.flatMap((c) => ("slot" in c && c.slot ? [c.slot.name] : []))));
  const missing = new Set<string>();
  let matched = 0;
  let shortened = 0;
  let squeezed = 0;

  type Made = { start: number; duration: number; clip: Record<string, unknown> };
  const lanes = new Map<string, Made[]>();
  for (const clip of foldSound(sequence, fps)) {
    const start = Math.max(0, frames(clip.start));
    let duration = Math.max(1, frames(clip.start + clip.duration) - frames(clip.start));
    const file = matchFile(clip.fileName, files);
    // A file fits its track: a picture on a video track, anything with sound on an audio track.
    const fits = file && (clip.kind === "video" ? file.kind !== "audio" : file.kind !== "image" && (file.kind === "audio" || file.hasAudio));
    let made: Record<string, unknown>;
    if (file && fits) {
      const type = clip.kind === "audio" ? "audio" : file.kind === "image" ? "image" : "video";
      let speed = type === "video" ? clip.speed : Math.abs(clip.speed) || 1;
      if (type === "image") speed = 1;
      let sourceIn = type === "image" ? 0 : Math.max(0, frames(clip.in));
      const length = mediaLengthFrames(file, fps);
      if (type !== "image" && length !== undefined) {
        // Backward, a clip starts on the latest frame it uses.
        if (speed < 0) sourceIn = Math.min(length - 1, sourceIn + Math.max(0, Math.round(duration * -speed) - 1));
        sourceIn = Math.min(sourceIn, Math.max(0, length - 1));
        const before = duration;
        while (duration > 1 && !fitsMedia({ in: sourceIn, duration, speed }, length)) {
          duration = Math.max(1, speed > 0 ? Math.floor((length - sourceIn) / speed) : Math.floor(sourceIn / -speed));
          if (!fitsMedia({ in: sourceIn, duration, speed }, length)) duration--;
        }
        if (duration < before) shortened++;
      }
      const sounds = type === "audio" || (type === "video" && clip.sound !== false && file.hasAudio);
      made = {
        type,
        assetId: file.id,
        in: sourceIn,
        speed,
        volume: sounds ? Math.min(VOLUME_MAX, Math.max(0, clip.volume ?? 1)) : 0,
        transform: { ...DEFAULT_TRANSFORM, ...(clip.kind === "video" && clip.opacity !== undefined && { opacity: Math.min(1, Math.max(0, clip.opacity)) }) },
      };
      matched++;
    } else {
      const wanted = clip.fileName ?? clip.name;
      missing.add(wanted);
      made = {
        type: "placeholder",
        accepts: clip.kind === "audio" ? "audio" : "visual",
        slot: { name: slotName(wanted, taken), hint: `Wants the file ${wanted}`.slice(0, LIMITS.slotHintChars) },
        transform: { ...DEFAULT_TRANSFORM },
      };
    }
    if (clip.kind === "video" && clip.dissolveIn && clip.dissolveIn > 0) {
      made.transitionIn = { kind: "crossfade", frames: Math.min(LIMITS.effectFramesMax, Math.max(1, frames(clip.dissolveIn))) };
    }
    const lane = `${clip.kind}:${clip.track}`;
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane)!.push({ start, duration, clip: made });
  }

  // Rounding to this project's frames can leave two clips of a track a frame over each other: the later one gives way.
  for (const list of lanes.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const over = prev.start + prev.duration - list[i].start;
      if (over <= 0) continue;
      squeezed++;
      list[i].start += over;
      list[i].duration -= over;
      if (typeof list[i].clip.in === "number" && (list[i].clip.speed as number) > 0) list[i].clip.in = (list[i].clip.in as number) + Math.round(over * (list[i].clip.speed as number));
      if (list[i].duration < 1) list.splice(i--, 1);
    }
    // A cross dissolve needs a clip ending exactly where this one starts.
    list.forEach((item, i) => {
      if (item.clip.transitionIn && (i === 0 || list[i - 1].start + list[i - 1].duration !== item.start)) delete item.clip.transitionIn;
    });
  }

  const laneOf = (kind: "video" | "audio") =>
    [...lanes.entries()]
      .filter(([key, list]) => key.startsWith(kind) && list.length > 0)
      .sort((a, b) => Number(a[0].split(":")[1]) - Number(b[0].split(":")[1]))
      .map(([, list]) => list);
  const pictures = laneOf("video");
  const sounds = laneOf("audio");
  if (pictures.length + sounds.length === 0) return { ok: false, message: "That timeline has no clips this project can take." };
  if ([...pictures, ...sounds].some((list) => list.length > LIMITS.clipsPerTrack)) return { ok: false, message: `One of that timeline's tracks has more than ${LIMITS.clipsPerTrack} clips, which is more than a track here holds.` };

  const ops: OpInput[] = [];
  const free = (kinds: Track["kind"][]) => doc.tracks.filter((t) => kinds.includes(t.kind) && t.clips.length === 0 && !t.locked).map((t) => t.id);
  const freePictures = free(["video", "overlay"]);
  const freeSounds = free(["audio"]);
  const newTracks = Math.max(0, pictures.length - freePictures.length) + Math.max(0, sounds.length - freeSounds.length);
  if (doc.tracks.length + newTracks > LIMITS.tracksPerProject) {
    return { ok: false, message: `That timeline needs ${newTracks} more ${newTracks === 1 ? "track" : "tracks"} than this project has room for (a project holds ${LIMITS.tracksPerProject}).` };
  }
  let pictureAt = doc.tracks.findLastIndex((t) => t.kind === "video" || t.kind === "overlay") + 1;
  let added = 0;
  const names: string[] = [];
  const place = (list: Made[], spare: string[], kind: "overlay" | "audio") => {
    let trackId = spare.shift();
    if (!trackId) {
      trackId = ids();
      const name = nextTrackName(doc, kind, names);
      names.push(name);
      // New picture tracks stack up in front of the project's last picture track; audio tracks go at the end.
      ops.push({ op: "add_track", track: { id: trackId, kind, name }, index: kind === "audio" ? doc.tracks.length + added : pictureAt++ });
      added++;
    }
    for (const item of list) ops.push({ op: "add_clip", trackId, clip: { ...item.clip, start: item.start, duration: item.duration } } as OpInput);
  };
  for (const list of pictures) place(list, freePictures, "overlay");
  for (const list of sounds) place(list, freeSounds, "audio");

  const marked = new Set((doc.markers ?? []).map((m) => m.at));
  let markers = 0;
  for (const marker of [...sequence.markers].sort((a, b) => a.at - b.at)) {
    const at = Math.max(0, frames(marker.at));
    if (marked.has(at) || (doc.markers?.length ?? 0) + markers >= LIMITS.markersPerProject) continue;
    marked.add(at);
    markers++;
    ops.push({ op: "add_marker", marker: { at, name: marker.name.replace(/[\r\n]+/g, " ").slice(0, LIMITS.markerNameChars) } });
  }
  if (ops.length > LIMITS.opsPerRequest) return { ok: false, message: `That timeline is ${ops.length} changes at once, more than can be saved in one go (${LIMITS.opsPerRequest}). Split it into shorter timelines.` };

  if (sequence.fps !== null && sequence.fps !== fps) notes.push(`The timeline was made at ${sequence.fps} frames a second and this project runs at ${fps}: every cut was moved to the nearest frame here.`);
  if (shortened > 0) notes.push(`${shortened} ${shortened === 1 ? "clip was" : "clips were"} shortened to fit the file in the library, which is shorter than the timeline expected.`);
  if (squeezed > 0) notes.push(`${squeezed} ${squeezed === 1 ? "clip was" : "clips were"} moved a frame so no two overlap.`);
  const clips = [...pictures, ...sounds].reduce((n, list) => n + list.length, 0);
  return { ok: true, ops, summary: { clips, matched, missing: [...missing], videoTracks: pictures.length, audioTracks: sounds.length, markers, notes } };
}

export type ExportResult = { text: string; notes: string[]; clips: number };

// The project as a timeline file for another editor. Its video, image and audio clips go, on their tracks in order,
// each named by its file in the library; text, shapes, adjustment layers, empty slots and every effect stay behind.
export function exportTimeline(doc: TimelineDoc, name: string, files: readonly LibraryFile[], format: InterchangeFormat): ExportResult {
  const fps = doc.fps;
  const byId = new Map(files.map((f) => [f.id, f]));
  const notes: string[] = [];
  const clips: SeqClip[] = [];
  let left = 0;
  let held = 0;
  let videoTrack = 0;
  let audioTrack = 0;
  for (const track of doc.tracks) {
    const media = track.clips.filter((c) => c.type === "video" || c.type === "image" || c.type === "audio");
    left += track.clips.length - media.length;
    if (media.length === 0) continue;
    const kind = track.kind === "audio" ? "audio" : "video";
    const index = kind === "audio" ? audioTrack++ : videoTrack++;
    for (const clip of media) {
      if (clip.type !== "video" && clip.type !== "image" && clip.type !== "audio") continue;
      const file = byId.get(clip.assetId);
      const fileName = file?.fileName ?? file?.name ?? clip.assetId;
      if (clip.speed === 0) held++;
      const speed = clip.speed === 0 ? 1 : clip.speed;
      // Backward, this project counts a clip's `in` from the latest frame it uses; other programs from the earliest.
      const sourceIn = speed < 0 ? Math.max(0, clip.in - Math.round(clip.duration * -speed) + 1) : clip.in;
      const volume = clip.type === "image" ? 0 : clip.volume * (track.muted ? 0 : (track.volume ?? 1));
      const seq: SeqClip = { name: file?.name ?? fileName, fileName, kind, track: index, start: clip.start / fps, duration: clip.duration / fps, in: sourceIn / fps, speed };
      if (clip.type === "video") seq.sound = volume > 0 && speed > 0 && file?.hasAudio !== false;
      if (clip.type !== "image" && volume !== 1 && volume > 0) seq.volume = volume;
      if (clip.type !== "audio" && clip.transform.opacity < 1) seq.opacity = clip.transform.opacity;
      if (clip.type !== "audio" && clip.transitionIn?.kind === "crossfade") seq.dissolveIn = clip.transitionIn.frames / fps;
      clips.push(seq);
    }
  }
  if (left > 0) notes.push(`${left} ${left === 1 ? "clip that is" : "clips that are"} text, a shape, an adjustment layer or an empty slot stayed behind: these files carry video, images and sound only.`);
  if (held > 0) notes.push(`${held} freeze ${held === 1 ? "frame is" : "frames are"} written as plain clips.`);
  notes.push("Colors, effects, crops, positions and keyframes are not part of these files. Relink the media by file name in the other program.");
  const sequence: Sequence = { name, fps, width: doc.width, height: doc.height, clips, markers: (doc.markers ?? []).map((m) => ({ at: m.at / fps, name: m.name })), notes: [] };
  const lengthOf = (fileName: string) => {
    const file = files.find((f) => f.fileName === fileName);
    return file && file.durationMs !== null ? file.durationMs / 1000 : null;
  };
  if (format === "edl") {
    const edl = writeEdl(sequence, fps);
    return { text: edl.text, notes: [...edl.notes, ...notes], clips: clips.length };
  }
  return { text: format === "otio" ? writeOtio(sequence, fps) : writeFcp7(sequence, fps, { width: doc.width, height: doc.height }, lengthOf), notes, clips: clips.length };
}
