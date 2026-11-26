import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { OpError } from "./errors";
import { CROP_PROPS, KEYFRAME_PROPS, TRANSFORM_PROPS, shiftKeyframes } from "./keyframes";
import type { Op } from "./ops";
import {
  CUSTOM_SIZE_ONLY,
  FORMAT_PRESETS,
  FRAME_SIZE_MESSAGE,
  NO_CROP,
  NO_STRETCH,
  isFrameSize,
  maxSafeAreaHeight,
  trackTakes,
} from "./presets";
import { captionStyleOf, captionTrack, defaultCaptionStyle, rewordRun, transcriptOf } from "./captions";
import { ADJUST_KEYS } from "./adjust";
import { ARROW_DEFAULTS } from "./shapes";
import { remapSpans, spansProblem } from "./spans";
import { TEXT_EXTRA_KEYS, TEXT_STYLE_DEFAULTS } from "./text-style";
import { AdjustmentClip, CaptionStyle, CaptionWords, MediaClip, PlaceholderClip, ShapeClipFields, TextClip, Transform, TextStyle, isMediaClip, shapeRules, slotOf } from "./types";
import type { Clip, FormatId, FrameSize, Guide, KeyframeProp, TextSpan, TimelineDoc, Track } from "./types";

// update_clip re-validates strictly so a typo'd or foreign key is rejected, not dropped.
const StrictMediaClip = MediaClip.extend({ transform: Transform.strict() }).strict();
const StrictTextClip = TextClip.extend({ transform: Transform.strict(), style: TextStyle.strict() }).strict();
const StrictPlaceholderClip = PlaceholderClip.extend({ transform: Transform.strict() }).strict();
const StrictShapeClip = ShapeClipFields.extend({ transform: Transform.strict() }).strict().superRefine(shapeRules);
const StrictAdjustmentClip = AdjustmentClip.extend({ transform: Transform.strict() }).strict();
const FROZEN_CLIP_KEYS = ["id", "type", "start", "duration"];
// The clip fields whose sub-keys are set, undone and expected one by one. Every other field, a transition or an
// emphasis included, is one value: a new one replaces the old whole, so no sub-key of the old one is left behind.
const MERGED_FIELDS: ReadonlySet<string> = new Set(["transform", "style", "keyframes", "adjust", "grade", "sound"]);

// Optional clip fields, each with its neutral value, filled the same way as TRANSFORM_FILL below. A keyframes patch
// also fills each property it names with an empty list, since keyframes merge one level deep like transform.
const CLIP_FILL: Record<string, () => unknown> = {
  keyframes: () => ({}),
  transitionIn: () => null,
  transitionOut: () => null,
  animationIn: () => null,
  animationOut: () => null,
  emphasis: () => null,
  captions: () => false,
  fadeIn: () => 0,
  fadeOut: () => 0,
  pan: () => 0,
  sound: () => ({}),
  adjust: () => ({}),
  grade: () => ({}),
  blend: () => "normal",
  chroma: () => null,
  mask: () => null,
  rounding: () => 0,
  spans: () => null,
  group: () => null,
};

// A shape's optional fields, each with the value its absence means, filled the same way so the first change to one
// records an undo that goes back to it.
const SHAPE_FILL: Record<string, () => unknown> = {
  fill: () => null,
  radius: () => 0,
  heads: () => ARROW_DEFAULTS.heads,
  head: () => ARROW_DEFAULTS.head,
  headSize: () => ARROW_DEFAULTS.headSize,
  bend: () => ARROW_DEFAULTS.bend,
  points: () => [],
};

// Which of those fields each kind of clip may carry. Sound has no picture to move or fade, and text animates
// itself instead of transitioning. A placeholder carries what the clip that fills it would: a visual slot the
// video and image effects (so a template's fade or move survives the fill), an audio slot none.
const VISUAL_EFFECTS = ["keyframes", "transitionIn", "transitionOut"] as const;
// What only a picture takes: its colours, and how it mixes with what is under it.
const PICTURE_EFFECTS = ["adjust", "grade", "blend", "chroma", "mask", "rounding"] as const;
// What a clip that sounds takes: captions for its speech, and a fade of its sound at either end.
const SOUND_EFFECTS = ["captions", "fadeIn", "fadeOut", "pan", "sound"] as const;
// A video clip takes both kinds; sound takes only its own (see CLIP_EFFECTS).
const CLIP_EFFECTS: Record<Exclude<Clip["type"], "placeholder">, readonly string[]> = {
  video: [...VISUAL_EFFECTS, ...SOUND_EFFECTS, ...PICTURE_EFFECTS],
  image: [...VISUAL_EFFECTS, ...PICTURE_EFFECTS],
  audio: [...SOUND_EFFECTS, "keyframes"], // its volume's only (assertKeyframesFit)
  text: ["keyframes", "animationIn", "animationOut", "emphasis", "blend", "spans"],
  shape: [...VISUAL_EFFECTS, "blend"],
  adjustment: ["keyframes", "adjust", "grade", "mask"], // its opacity's and colours' keyframes only (assertKeyframesFit)
};

// A clip's ways in and out, each with the value that means it has none. A split takes the way out off the left piece
// and the way in off the right one.
const WAY_NONE: Record<string, unknown> = { transitionIn: null, transitionOut: null, animationIn: null, animationOut: null, fadeIn: 0, fadeOut: 0 };

type EffectsHolder = Pick<Clip, "type"> & { accepts?: "visual" | "audio" };

// Every kind of clip can be in a group, an empty slot too.
function clipEffects(clip: EffectsHolder): readonly string[] {
  if (clip.type === "placeholder") return clip.accepts === "visual" ? [...VISUAL_EFFECTS, "group"] : ["group"];
  return [...CLIP_EFFECTS[clip.type], "group"];
}

// Optional transform fields, each with its neutral value. update_clip fills a missing one before it is set or
// expected, so the first change records an undo that goes back to the neutral value.
const TRANSFORM_FILL: Record<string, () => unknown> = { crop: () => ({ ...NO_CROP }), stretch: () => NO_STRETCH, flipH: () => false, flipV: () => false };

// A sound's clean-up with every part off.
const SOUND_OFF: Record<string, unknown> = { lowCut: false, gate: 0, bass: 0, mid: 0, treble: 0, compress: 0, denoise: 0 };

// A grade with every part off: wheels at rest, straight curves, no look-up table and, for one, all of it.
const GRADE_OFF: Record<string, () => unknown> = {
  lift: () => ({ x: 0, y: 0, level: 0 }),
  gamma: () => ({ x: 0, y: 0, level: 0 }),
  gain: () => ({ x: 0, y: 0, level: 0 }),
  curve: () => [],
  curveR: () => [],
  curveG: () => [],
  curveB: () => [],
  lut: () => null,
  lutAmount: () => 1,
};

// A text style's optional fields, filled the same way before one is set or expected.
const STYLE_FILL: ReadonlySet<string> = new Set(TEXT_EXTRA_KEYS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The keys an update_clip patch or expect gives a value for, at the top or inside one of its plain objects.
function givenKeys(part: unknown, inside?: string): string[] {
  if (!isPlainObject(part)) return [];
  const obj = inside === undefined ? part : part[inside];
  if (!isPlainObject(obj)) return [];
  return Object.keys(obj).filter((key) => obj[key] !== undefined);
}

// An empty list of spans is stored as none.
const orNull = (spans: TextSpan[]): TextSpan[] | null => (spans.length > 0 ? spans : null);

function assertEffectsFit(clip: EffectsHolder, keys: string[], opIndex: number, opName: string) {
  const allowed = clipEffects(clip);
  for (const key of keys) {
    if (Object.hasOwn(CLIP_FILL, key) && !allowed.includes(key)) {
      const kind = clip.type === "placeholder" ? `${clip.accepts} placeholder` : clip.type;
      const article = /^[aeiou]/.test(kind) ? "an" : "a";
      throw new OpError("INVALID", `${opName}: "${key}" is not allowed on ${article} ${kind} clip`, opIndex);
    }
  }
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => isEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && isEqual(a[k], b[k]));
  }
  return false;
}

// The fields that differ between before and after, with their old and new values.
function diffFields<T extends object>(before: T, after: T): { old: Partial<T>; now: Partial<T> } {
  const old: Partial<T> = {};
  const now: Partial<T> = {};
  for (const key of Object.keys(before) as (keyof T)[]) {
    if (!isEqual(before[key], after[key])) {
      old[key] = before[key];
      now[key] = after[key];
    }
  }
  return { old, now };
}

// An op's `expect` guard: every listed field must still hold its listed value.
// transform, style and keyframes compare only their listed sub-keys; any other field compares whole.
function holds(current: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => {
    if (value === undefined) return true;
    const actual = current[key];
    if (MERGED_FIELDS.has(key) && isPlainObject(value) && isPlainObject(actual)) {
      return Object.entries(value).every(([sub, v]) => isEqual(actual[sub], v));
    }
    return isEqual(actual, value);
  });
}

// The same ids, in any order.
function sameIds(actual: string[], expected: string[]): boolean {
  const set = new Set(expected);
  return actual.length === expected.length && set.size === expected.length && actual.every((id) => set.has(id));
}

function sortTrack(track: Track) {
  track.clips.sort((a, b) => a.start - b.start);
}

function findTrack(doc: TimelineDoc, trackId: string, opIndex: number, opName: string) {
  const trackIndex = doc.tracks.findIndex((t) => t.id === trackId);
  if (trackIndex < 0) throw new OpError("NOT_FOUND", `${opName}: track "${trackId}" not found`, opIndex);
  return { track: doc.tracks[trackIndex], trackIndex };
}

function findClip(doc: TimelineDoc, clipId: string, opIndex: number, opName: string) {
  for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex++) {
    const track = doc.tracks[trackIndex];
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) return { track, trackIndex, clipIndex };
  }
  throw new OpError("NOT_FOUND", `${opName}: clip "${clipId}" not found`, opIndex);
}

// The guide itself, in the document being changed, so a move can set it in place.
function findGuide(doc: TimelineDoc, guideId: string, opName: string, opIndex: number): Guide {
  const guide = doc.guides?.find((g) => g.id === guideId);
  if (!guide) throw new OpError("NOT_FOUND", `${opName}: guide "${guideId}" not found`, opIndex);
  return guide;
}

function assertUnlocked(track: Track, opIndex: number, opName: string) {
  if (track.locked) {
    throw new OpError("TRACK_LOCKED", `${opName}: track "${track.id}" is locked`, opIndex);
  }
}

function assertAccepts(track: Track, clip: Clip, opIndex: number, opName: string) {
  if (!trackTakes(track.kind, clip)) {
    throw new OpError(
      "WRONG_TRACK_KIND",
      `${opName}: ${clip.type} clip "${clip.id}" cannot go on ${track.kind} track "${track.id}"`,
      opIndex,
    );
  }
}

// Only a video runs backward or holds a frame: sound and stills have one way to play.
function assertSpeedFits(clip: Clip, opIndex: number, opName: string) {
  if ((clip.type === "audio" || clip.type === "image") && clip.speed <= 0) {
    const kind = clip.type === "audio" ? "an audio" : "an image";
    throw new OpError("INVALID", `${opName}: ${kind} clip's speed must be above 0`, opIndex);
  }
}

// A text's styled spans lie inside its words, in order.
function assertSpansFit(clip: Clip, opIndex: number, opName: string) {
  if (clip.type !== "text" || !clip.spans) return;
  const problem = spansProblem(clip.text, clip.spans);
  if (problem) throw new OpError("INVALID", `${opName}: clip "${clip.id}" spans are invalid: ${problem}`, opIndex);
}

// A volume is keyed only on a clip that sounds, and a sound has no picture to key.
function assertKeyframesFit(clip: Clip, opIndex: number, opName: string) {
  const keys = clip.keyframes;
  if (!keys) return;
  const has = (prop: KeyframeProp) => (keys[prop]?.length ?? 0) > 0;
  if (has("volume") && clip.type !== "video" && clip.type !== "audio") {
    throw new OpError("INVALID", `${opName}: only a video or audio clip takes volume keyframes`, opIndex);
  }
  if (clip.type === "audio" && TRANSFORM_PROPS.some(has)) {
    throw new OpError("INVALID", `${opName}: an audio clip takes only volume keyframes`, opIndex);
  }
  if (clip.type === "adjustment" && (has("x") || has("y") || has("scale") || has("rotation") || has("volume") || CROP_PROPS.some(has))) {
    throw new OpError("INVALID", `${opName}: an adjustment layer takes only opacity and colour keyframes`, opIndex);
  }
  // A crop is keyed where a crop can be set: a video, an image, text, and the slot one will fill.
  if ((clip.type === "shape" || clip.type === "audio") && CROP_PROPS.some(has)) {
    throw new OpError("INVALID", `${opName}: ${clip.type === "shape" ? "a shape" : "an audio clip"} takes no crop keyframes`, opIndex);
  }
  // Colours are keyed where colours are set: on a video, an image (and the slot one will fill) or an adjustment layer.
  const pictured = clip.type === "video" || clip.type === "image" || clip.type === "placeholder" || clip.type === "adjustment";
  const colour = pictured ? undefined : ADJUST_KEYS.find(has);
  if (colour) throw new OpError("INVALID", `${opName}: only a video or image takes ${colour} keyframes`, opIndex);
}

function assertNoOverlap(track: Track, opIndex: number, opName: string) {
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (prev.start + prev.duration > next.start) {
      throw new OpError(
        "OVERLAP",
        `${opName}: clips "${prev.id}" and "${next.id}" overlap on track "${track.id}"`,
        opIndex,
      );
    }
  }
}

function assertRoomForTrack(doc: TimelineDoc, opIndex: number, opName: string) {
  if (doc.tracks.length + 1 > LIMITS.tracksPerProject) {
    throw new OpError("LIMIT_EXCEEDED", `${opName}: a project can have at most ${LIMITS.tracksPerProject} tracks`, opIndex);
  }
}

function assertClipCount(trackId: string, countAfter: number, opIndex: number, opName: string) {
  if (countAfter > LIMITS.clipsPerTrack) {
    throw new OpError("LIMIT_EXCEEDED", `${opName}: track "${trackId}" can have at most ${LIMITS.clipsPerTrack} clips`, opIndex);
  }
}

function assertOneCaptionTrack(doc: TimelineDoc, incoming: Track, replacedIndex: number, opIndex: number, opName: string) {
  const countNow = doc.tracks.filter((t) => t.kind === "caption").length;
  const replaced = replacedIndex >= 0 && doc.tracks[replacedIndex].kind === "caption" ? 1 : 0;
  const countAfter = countNow - replaced + (incoming.kind === "caption" ? 1 : 0);
  if (countAfter > 1 && countAfter > countNow) {
    throw new OpError("INVALID", `${opName}: a project can have only one caption track`, opIndex);
  }
}

// Caption words and style are edited through the caption track, so a locked one holds them still.
function assertCaptionsUnlocked(doc: TimelineDoc, opIndex: number, opName: string) {
  const track = captionTrack(doc);
  if (track?.locked) throw new OpError("TRACK_LOCKED", `${opName}: track "${track.id}" is locked`, opIndex);
}

// Stores the transcripts, and drops the empty list, and the whole captions field once it holds nothing (like guides).
function setTranscripts(doc: TimelineDoc, transcripts: Record<string, CaptionWords>) {
  const captions = { ...doc.captions };
  if (Object.keys(transcripts).length) captions.transcripts = transcripts;
  else delete captions.transcripts;
  if (captions.style || captions.transcripts) doc.captions = captions;
  else delete doc.captions;
}

function clipIdInUse(doc: TimelineDoc, clipId: string, exceptTrackId?: string): boolean {
  return doc.tracks.some((t) => t.id !== exceptTrackId && t.clips.some((c) => c.id === clipId));
}

export function applyOps(input: TimelineDoc, ops: Op[]): { doc: TimelineDoc; inverse: Op[] } {
  const doc = structuredClone(input);
  // One group of inverse ops per op, each in apply order. The groups are reversed
  // at the end, so a multi-op group keeps its own order.
  const groups: Op[][] = [];

  ops.forEach((op, opIndex) => {
    const name = op.op;
    const stale = (what: string) => new OpError("STALE", `${name}: ${what} changed since this edit`, opIndex);
    switch (op.op) {
      case "add_track": {
        if (doc.tracks.some((t) => t.id === op.track.id)) {
          throw new OpError("DUPLICATE_ID", `${name}: track id "${op.track.id}" already exists`, opIndex);
        }
        const index = op.index ?? doc.tracks.length;
        if (index < 0 || index > doc.tracks.length) {
          throw new OpError(
            "INVALID",
            `${name}: index ${index} is outside 0..${doc.tracks.length} for track "${op.track.id}"`,
            opIndex,
          );
        }
        assertRoomForTrack(doc, opIndex, name);
        assertOneCaptionTrack(doc, op.track as Track, -1, opIndex, name);
        doc.tracks.splice(index, 0, {
          id: op.track.id,
          kind: op.track.kind,
          name: op.track.name,
          muted: false,
          hidden: false,
          locked: false,
          clips: [],
        });
        groups.push([{ op: "remove_track", trackId: op.track.id, expect: { clipIds: [] } }]);
        break;
      }

      case "remove_track": {
        const { track, trackIndex } = findTrack(doc, op.trackId, opIndex, name);
        if (op.expect && !sameIds(track.clips.map((c) => c.id), op.expect.clipIds)) {
          throw stale(`track "${op.trackId}"`);
        }
        const [removed] = doc.tracks.splice(trackIndex, 1);
        groups.push([{ op: "replace_track", track: removed, index: trackIndex, restore: true }]);
        break;
      }

      case "update_track": {
        const { track } = findTrack(doc, op.trackId, opIndex, name);
        // A track's volume is 1 until it is set; it is filled in before it is expected or changed, so an undo goes back to 1.
        if ((op.patch.volume !== undefined || op.expect?.volume !== undefined) && track.volume === undefined) track.volume = 1;
        if (op.expect && !holds(track, op.expect)) throw stale(`track "${op.trackId}"`);
        const fields = (t: Track) => ({ name: t.name, muted: t.muted, hidden: t.hidden, locked: t.locked, ...(t.volume !== undefined && { volume: t.volume }) });
        const before = fields(track);
        if (op.patch.volume !== undefined) track.volume = op.patch.volume;
        if (op.patch.name !== undefined) track.name = op.patch.name;
        if (op.patch.muted !== undefined) track.muted = op.patch.muted;
        if (op.patch.hidden !== undefined) track.hidden = op.patch.hidden;
        if (op.patch.locked !== undefined) track.locked = op.patch.locked;
        const { old, now } = diffFields(before, fields(track));
        if (Object.keys(old).length) {
          groups.push([{ op: "update_track", trackId: op.trackId, patch: old, expect: now }]);
        }
        break;
      }

      case "move_track": {
        const { trackIndex } = findTrack(doc, op.trackId, opIndex, name);
        if (op.expect && op.expect.index !== trackIndex) throw stale(`track "${op.trackId}"`);
        const [moved] = doc.tracks.splice(trackIndex, 1);
        const index = Math.min(op.index, doc.tracks.length);
        doc.tracks.splice(index, 0, moved);
        if (index !== trackIndex) {
          groups.push([{ op: "move_track", trackId: op.trackId, index: trackIndex, expect: { index } }]);
        }
        break;
      }

      case "replace_track": {
        const incoming = structuredClone(op.track);
        const existingIndex = doc.tracks.findIndex((t) => t.id === incoming.id);
        if (op.restore && existingIndex >= 0) {
          throw new OpError("DUPLICATE_ID", `${name}: track id "${incoming.id}" already exists`, opIndex);
        }
        if (!op.restore && existingIndex < 0 && (op.index < 0 || op.index > doc.tracks.length)) {
          throw new OpError(
            "INVALID",
            `${name}: index ${op.index} is outside 0..${doc.tracks.length} for track "${incoming.id}"`,
            opIndex,
          );
        }
        if (existingIndex < 0) assertRoomForTrack(doc, opIndex, name);
        assertOneCaptionTrack(doc, incoming, existingIndex, opIndex, name);
        const before = existingIndex >= 0 ? doc.tracks[existingIndex].clips.length : 0;
        if (incoming.clips.length > before) assertClipCount(incoming.id, incoming.clips.length, opIndex, name);
        const seen = new Set<string>();
        for (const c of incoming.clips) {
          if (seen.has(c.id) || clipIdInUse(doc, c.id, incoming.id)) {
            throw new OpError("DUPLICATE_ID", `${name}: clip id "${c.id}" already exists`, opIndex);
          }
          seen.add(c.id);
          assertAccepts(incoming, c, opIndex, name);
        }
        sortTrack(incoming);
        assertNoOverlap(incoming, opIndex, name);
        if (existingIndex >= 0) {
          groups.push([{ op: "replace_track", track: doc.tracks[existingIndex], index: existingIndex }]);
          doc.tracks[existingIndex] = incoming;
        } else {
          groups.push([{ op: "remove_track", trackId: incoming.id, expect: { clipIds: incoming.clips.map((c) => c.id) } }]);
          doc.tracks.splice(Math.min(op.index, doc.tracks.length), 0, incoming);
        }
        break;
      }

      case "add_clip": {
        const { track } = findTrack(doc, op.trackId, opIndex, name);
        assertUnlocked(track, opIndex, name);
        if (clipIdInUse(doc, op.clip.id)) {
          throw new OpError("DUPLICATE_ID", `${name}: clip id "${op.clip.id}" already exists`, opIndex);
        }
        assertAccepts(track, op.clip, opIndex, name);
        assertSpeedFits(op.clip, opIndex, name);
        assertKeyframesFit(op.clip, opIndex, name);
        assertSpansFit(op.clip, opIndex, name);
        // A null is the neutral value, so a clip that spells out "none" for a field it can't use is still fine.
        const carried: Record<string, unknown> = op.clip;
        assertEffectsFit(op.clip, givenKeys(op.clip).filter((key) => carried[key] !== null), opIndex, name);
        assertClipCount(track.id, track.clips.length + 1, opIndex, name);
        if (op.ripple) {
          for (const c of track.clips) if (c.start >= op.clip.start) c.start += op.clip.duration;
          // Guarded: if the new clip was moved or resized since, closing the gap where it now sits would leave one where it was.
          groups.push([
            { op: "remove_clip", clipId: op.clip.id, ripple: true, expect: { start: op.clip.start, duration: op.clip.duration } },
          ]);
        } else {
          groups.push([{ op: "remove_clip", clipId: op.clip.id }]);
        }
        track.clips.push(structuredClone(op.clip));
        sortTrack(track);
        assertNoOverlap(track, opIndex, name);
        break;
      }

      case "remove_clip": {
        const { track, clipIndex } = findClip(doc, op.clipId, opIndex, name);
        assertUnlocked(track, opIndex, name);
        if (op.expect && !holds(track.clips[clipIndex], op.expect)) throw stale(`clip "${op.clipId}"`);
        const [removed] = track.clips.splice(clipIndex, 1);
        if (op.ripple) {
          const removedEnd = removed.start + removed.duration;
          for (const c of track.clips) if (c.start >= removedEnd) c.start -= removed.duration;
          groups.push([{ op: "add_clip", trackId: track.id, clip: removed, ripple: true }]);
        } else {
          groups.push([{ op: "add_clip", trackId: track.id, clip: removed }]);
        }
        sortTrack(track);
        break;
      }

      case "move_clip": {
        const from = findClip(doc, op.clipId, opIndex, name);
        const moving = from.track.clips[from.clipIndex];
        if (op.expect && !holds({ start: moving.start, trackId: from.track.id }, op.expect)) {
          throw stale(`clip "${op.clipId}"`);
        }
        const to = op.trackId ? findTrack(doc, op.trackId, opIndex, name) : from;
        assertUnlocked(from.track, opIndex, name);
        assertUnlocked(to.track, opIndex, name);
        assertAccepts(to.track, moving, opIndex, name);
        if (to.trackIndex !== from.trackIndex) assertClipCount(to.track.id, to.track.clips.length + 1, opIndex, name);
        groups.push([
          to.trackIndex === from.trackIndex
            ? { op: "move_clip", clipId: op.clipId, start: moving.start, expect: { start: op.start } }
            : {
                op: "move_clip",
                clipId: op.clipId,
                start: moving.start,
                trackId: from.track.id,
                expect: { start: op.start, trackId: to.track.id },
              },
        ]);
        from.track.clips.splice(from.clipIndex, 1);
        moving.start = op.start;
        to.track.clips.push(moving);
        sortTrack(to.track);
        assertNoOverlap(to.track, opIndex, name);
        break;
      }

      case "trim_clip": {
        const { track, clipIndex } = findClip(doc, op.clipId, opIndex, name);
        assertUnlocked(track, opIndex, name);
        const target = track.clips[clipIndex];
        if (op.expect && !holds(target, op.expect)) throw stale(`clip "${op.clipId}"`);
        if (op.in !== undefined && (op.edge !== "start" || !isMediaClip(target))) {
          throw new OpError(
            "INVALID",
            `${name}: "in" is only allowed when trimming the start of a media clip`,
            opIndex,
          );
        }
        const outOfRange = (why: string) =>
          new OpError("TRIM_OUT_OF_RANGE", `${name}: clip "${op.clipId}" ${why}`, opIndex);
        if (op.to < 0) throw outOfRange(`${op.edge} cannot move to frame ${op.to}`);
        let start = target.start;
        let duration = target.duration;
        let sourceIn: number | undefined;
        if (op.edge === "start") {
          const delta = op.to - target.start;
          start = op.to;
          duration = target.duration - delta;
          // An image has no source timeline, so a start trim leaves its `in` alone.
          if (op.in !== undefined) {
            sourceIn = op.in;
          } else if (target.type === "video" || target.type === "audio") {
            // Counted back from where the clip ends in its source, so that end does not move.
            const sourceEnd = target.in + Math.round(target.duration * target.speed);
            sourceIn = sourceEnd - Math.round(duration * target.speed);
            if (sourceIn < 0) throw outOfRange("cannot start before the start of its source");
          }
        } else {
          duration = op.to - target.start;
        }
        if (duration < 1) throw outOfRange(`would have a duration of ${duration} frames`);
        // A clip that plays backward runs towards the start of its source, so a longer one can run out of it.
        if (target.type === "video" && target.speed < 0 && (sourceIn ?? target.in) + Math.round(duration * target.speed) < -1) {
          throw outOfRange("cannot run back past the start of its source");
        }
        // An end-trim undo sets the end, so it needs start and duration unchanged. A
        // start-trim undo keeps the current end, so a later end trim by someone else survives it.
        if (op.edge === "end") {
          const to = target.start + target.duration;
          groups.push([{ op: "trim_clip", clipId: op.clipId, edge: "end", to, expect: { start, duration } }]);
        } else if (sourceIn === undefined || !isMediaClip(target)) {
          groups.push([{ op: "trim_clip", clipId: op.clipId, edge: "start", to: target.start, expect: { start } }]);
        } else {
          groups.push([
            {
              op: "trim_clip",
              clipId: op.clipId,
              edge: "start",
              to: target.start,
              in: target.in,
              expect: { start, in: sourceIn },
            },
          ]);
        }
        // Keyframes count from the clip's start, so they move against a start trim to stay on the same picture.
        // The undo is a start trim back, which moves them back.
        if (target.keyframes && start !== target.start) target.keyframes = shiftKeyframes(target.keyframes, target.start - start);
        target.start = start;
        target.duration = duration;
        if ((target.type === "video" || target.type === "audio" || target.type === "image") && sourceIn !== undefined) target.in = sourceIn;
        sortTrack(track);
        assertNoOverlap(track, opIndex, name);
        break;
      }

      case "split_clip": {
        const { track, clipIndex } = findClip(doc, op.clipId, opIndex, name);
        assertUnlocked(track, opIndex, name);
        const left = track.clips[clipIndex];
        const end = left.start + left.duration;
        if (op.at <= left.start || op.at >= end) {
          throw new OpError(
            "INVALID",
            `${name}: at ${op.at} must be inside clip "${op.clipId}" (${left.start}, ${end})`,
            opIndex,
          );
        }
        if (clipIdInUse(doc, op.newClipId)) {
          throw new OpError("DUPLICATE_ID", `${name}: clip id "${op.newClipId}" already exists`, opIndex);
        }
        assertClipCount(track.id, track.clips.length + 1, opIndex, name);
        // The cut is not an end or a start, so the left piece gives up its way out and the right its way in.
        // The undo puts back the left piece's way out; the right piece goes away with whatever it had.
        const leftOut: Record<string, unknown> = {};
        const outKeys = ["transitionOut", "animationOut", "fadeOut"] as const;
        for (const key of outKeys) {
          const value = (left as Record<string, unknown>)[key];
          if (value !== undefined && value !== WAY_NONE[key]) leftOut[key] = value;
        }
        const undo: Op[] = [
          { op: "remove_clip", clipId: op.newClipId, expect: { start: op.at, duration: end - op.at } },
          {
            op: "trim_clip",
            clipId: op.clipId,
            edge: "end",
            to: end,
            expect: { start: left.start, duration: op.at - left.start },
          },
        ];
        if (Object.keys(leftOut).length) {
          const cleared = Object.fromEntries(Object.keys(leftOut).map((key) => [key, WAY_NONE[key]]));
          undo.push({ op: "update_clip", clipId: op.clipId, patch: leftOut, expect: cleared });
        }
        groups.push(undo);
        const right = structuredClone(left);
        right.id = op.newClipId;
        right.start = op.at;
        right.duration = end - op.at;
        // Both pieces keep the whole keyframe lists, so the right one carries on along the same curve.
        if (right.keyframes) right.keyframes = shiftKeyframes(right.keyframes, left.start - op.at);
        const l = left as Record<string, unknown>;
        const r = right as Record<string, unknown>;
        for (const key of outKeys) if (key in l) l[key] = WAY_NONE[key];
        for (const key of ["transitionIn", "animationIn", "fadeIn"]) if (key in r) r[key] = WAY_NONE[key];
        if ((right.type === "video" && left.type === "video") || (right.type === "audio" && left.type === "audio")) {
          // Counted back from where the clip ends in its source, so the right piece ends there too.
          const sourceEnd = left.in + Math.round(left.duration * left.speed);
          right.in = sourceEnd - Math.round(right.duration * left.speed);
        } else if (right.type === "image" && left.type === "image") {
          right.in = left.in + Math.floor((op.at - left.start) * left.speed);
        }
        left.duration = op.at - left.start;
        track.clips.push(right);
        sortTrack(track);
        break;
      }

      case "update_clip": {
        const { track, clipIndex } = findClip(doc, op.clipId, opIndex, name);
        assertUnlocked(track, opIndex, name);
        const current = track.clips[clipIndex];
        // New words move a text's styled spans with them, so each stays on its own words; an op that names the spans
        // says what they become itself. The undo then puts the old spans back with the old words.
        const patch: typeof op.patch =
          current.type === "text" && typeof op.patch.text === "string" && op.patch.spans === undefined && current.spans?.length
            ? { ...op.patch, spans: orNull(remapSpans(current.text, op.patch.text, current.spans)) }
            : op.patch;
        assertEffectsFit(current, givenKeys(patch), opIndex, name);
        const transform: Record<string, unknown> = current.transform;
        for (const key of [...givenKeys(patch, "transform"), ...givenKeys(op.expect, "transform")]) {
          if (Object.hasOwn(TRANSFORM_FILL, key) && transform[key] === undefined) transform[key] = TRANSFORM_FILL[key]();
        }
        if (current.type === "text") {
          const style: Record<string, unknown> = current.style;
          for (const key of [...givenKeys(patch, "style"), ...givenKeys(op.expect, "style")]) {
            if (STYLE_FILL.has(key) && style[key] === undefined) style[key] = TEXT_STYLE_DEFAULTS[key as keyof typeof TEXT_STYLE_DEFAULTS];
          }
        }
        const fields: Record<string, unknown> = current;
        for (const key of [...givenKeys(patch), ...givenKeys(op.expect)]) {
          if (clipEffects(current).includes(key) && fields[key] === undefined) fields[key] = CLIP_FILL[key]();
          if (current.type === "shape" && Object.hasOwn(SHAPE_FILL, key) && fields[key] === undefined) fields[key] = SHAPE_FILL[key]();
        }
        // Colour changes merge one level deep too, and each one named starts from 0.
        const adjust = fields.adjust;
        if (isPlainObject(adjust)) {
          for (const key of [...givenKeys(patch, "adjust"), ...givenKeys(op.expect, "adjust")]) {
            if ((ADJUST_KEYS as readonly string[]).includes(key) && adjust[key] === undefined) adjust[key] = 0;
          }
        }
        // A sound's clean-up merges one level deep as well: each part named starts from off.
        const sound = fields.sound;
        if (isPlainObject(sound)) {
          for (const key of [...givenKeys(patch, "sound"), ...givenKeys(op.expect, "sound")]) {
            if (Object.hasOwn(SOUND_OFF, key) && sound[key] === undefined) sound[key] = SOUND_OFF[key];
          }
        }
        // So does a grade: each part named starts from off, and is then set, undone and expected whole.
        const grade = fields.grade;
        if (isPlainObject(grade)) {
          for (const key of [...givenKeys(patch, "grade"), ...givenKeys(op.expect, "grade")]) {
            if (Object.hasOwn(GRADE_OFF, key) && grade[key] === undefined) grade[key] = GRADE_OFF[key]();
          }
        }
        const keyframes = fields.keyframes;
        if (isPlainObject(keyframes)) {
          for (const key of [...givenKeys(patch, "keyframes"), ...givenKeys(op.expect, "keyframes")]) {
            if ((KEYFRAME_PROPS as readonly string[]).includes(key) && keyframes[key] === undefined) keyframes[key] = [];
          }
        }
        if (op.expect) {
          // slot: null means "has no slot", which holds when the key is absent (its neutral value, never stored).
          const { slot: expectSlot, ...otherExpect } = op.expect;
          const slotHolds = expectSlot === undefined || (expectSlot === null ? slotOf(current) === undefined : holds(current, { slot: expectSlot }));
          if (!slotHolds || !holds(current, otherExpect)) throw stale(`clip "${op.clipId}"`);
        }
        for (const key of FROZEN_CLIP_KEYS) {
          if (key in patch) {
            throw new OpError("INVALID", `${name}: "${key}" cannot be changed with update_clip`, opIndex);
          }
        }
        const merged: Record<string, unknown> = { ...current };
        for (const [key, value] of Object.entries(patch)) {
          const existing = merged[key];
          if (key === "slot") {
            // A slot is replaced whole, and null takes it off.
            if (value === null) delete merged.slot;
            else merged.slot = value;
            continue;
          }
          merged[key] =
            MERGED_FIELDS.has(key) && isPlainObject(existing) && isPlainObject(value) ? { ...existing, ...value } : value;
        }
        const schema =
          current.type === "text" ? StrictTextClip
          : current.type === "placeholder" ? StrictPlaceholderClip
          : current.type === "shape" ? StrictShapeClip
          : current.type === "adjustment" ? StrictAdjustmentClip
          : StrictMediaClip;
        const result = schema.safeParse(merged);
        if (!result.success) {
          const issue = result.error.issues[0];
          const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
          throw new OpError(
            "INVALID",
            `${name}: clip "${op.clipId}" patch is invalid: ${where}${issue.message}`,
            opIndex,
          );
        }
        assertAccepts(track, result.data, opIndex, name);
        assertSpeedFits(result.data, opIndex, name);
        assertKeyframesFit(result.data, opIndex, name);
        assertSpansFit(result.data, opIndex, name);
        const before: Record<string, unknown> = current;
        const after: Record<string, unknown> = result.data;
        const undo: Record<string, unknown> = {};
        const written: Record<string, unknown> = {};
        for (const key of Object.keys(patch)) {
          // transform, style and keyframes are compared one level deep, so the
          // undo only touches the sub-keys this op changed.
          const b = before[key];
          const a = after[key];
          if (key === "slot") {
            // Atomic: whole slot in the undo, null when there was none or is none.
            if (!isEqual(b, a)) {
              undo.slot = b ?? null;
              written.slot = a ?? null;
            }
          } else if (MERGED_FIELDS.has(key) && isPlainObject(b) && isPlainObject(a)) {
            const { old, now } = diffFields(b, a);
            if (Object.keys(old).length) {
              undo[key] = old;
              written[key] = now;
            }
          } else if (!isEqual(b, a)) {
            undo[key] = b;
            written[key] = a;
          }
        }
        if (Object.keys(undo).length) {
          groups.push([{ op: "update_clip", clipId: op.clipId, patch: undo, expect: written }]);
        }
        track.clips[clipIndex] = result.data as z.infer<typeof schema>;
        break;
      }

      case "set_format": {
        // A custom format carries its own size; a named one takes its preset's and refuses a size.
        let size: FrameSize;
        if (op.format === "custom") {
          const { width, height } = op;
          if (width === undefined || height === undefined || !isFrameSize(width, height)) {
            throw new OpError("INVALID", `set_format: ${FRAME_SIZE_MESSAGE}`, opIndex);
          }
          size = { width, height };
        } else {
          if (op.width !== undefined || op.height !== undefined) {
            throw new OpError("INVALID", `set_format: ${CUSTOM_SIZE_ONLY}`, opIndex);
          }
          size = FORMAT_PRESETS[op.format];
        }
        const guard = op.expect;
        if (
          guard &&
          (guard.format !== doc.format ||
            (guard.width !== undefined && guard.width !== doc.width) ||
            (guard.height !== undefined && guard.height !== doc.height))
        ) {
          throw stale("the format");
        }
        // Each side carries a size only when its format is custom, so between named formats this is the plain undo.
        const sizeOf = (format: FormatId, of: FrameSize) =>
          format === "custom" ? { width: of.width, height: of.height } : {};
        groups.push([
          {
            op: "set_format",
            format: doc.format,
            ...sizeOf(doc.format, doc),
            expect: { format: op.format, ...sizeOf(op.format, size) },
          },
        ]);
        doc.format = op.format;
        doc.width = size.width;
        doc.height = size.height;
        break;
      }

      case "set_safe_area": {
        const now = doc.safeAreas?.[op.format] ?? null;
        if (op.expect && !isEqual(op.expect.size, now)) throw stale("the safe area");
        if (op.size && op.size.height > maxSafeAreaHeight(op.format)) {
          throw new OpError("INVALID", `${name}: the height can be at most ${maxSafeAreaHeight(op.format)} for ${op.format}, below its top`, opIndex);
        }
        groups.push([{ op: "set_safe_area", format: op.format, size: now, expect: { size: op.size } }]);
        const rest = { ...doc.safeAreas };
        delete rest[op.format];
        if (op.size) rest[op.format] = { width: op.size.width, height: op.size.height };
        if (Object.keys(rest).length) doc.safeAreas = rest;
        else delete doc.safeAreas;
        break;
      }

      case "add_guide": {
        const guides = doc.guides ?? [];
        if (guides.some((g) => g.id === op.guide.id)) {
          throw new OpError("DUPLICATE_ID", `${name}: guide id "${op.guide.id}" already exists`, opIndex);
        }
        if (guides.length + 1 > LIMITS.guidesPerProject) {
          throw new OpError("LIMIT_EXCEEDED", `${name}: a project can have at most ${LIMITS.guidesPerProject} guides`, opIndex);
        }
        // Guides' order means nothing on screen, so an index past the end (an undone removal after a teammate removed
        // another) goes last instead of failing.
        const index = Math.max(0, Math.min(op.index ?? guides.length, guides.length));
        const guide = { id: op.guide.id, axis: op.guide.axis, at: op.guide.at };
        doc.guides = [...guides.slice(0, index), guide, ...guides.slice(index)];
        groups.push([{ op: "remove_guide", guideId: guide.id, expect: { guide: { ...guide } } }]);
        break;
      }

      case "move_guide": {
        const guide = findGuide(doc, op.guideId, name, opIndex);
        if (op.expect && op.expect.at !== guide.at) throw stale(`guide "${op.guideId}"`);
        groups.push([{ op: "move_guide", guideId: guide.id, at: guide.at, expect: { at: op.at } }]);
        guide.at = op.at;
        break;
      }

      case "remove_guide": {
        const guide = findGuide(doc, op.guideId, name, opIndex);
        if (op.expect && !isEqual(op.expect.guide, guide)) throw stale(`guide "${op.guideId}"`);
        const index = (doc.guides ?? []).indexOf(guide);
        const rest = (doc.guides ?? []).filter((g) => g.id !== op.guideId);
        if (rest.length) doc.guides = rest;
        else delete doc.guides;
        groups.push([{ op: "add_guide", guide: { ...guide }, index }]);
        break;
      }

      case "add_marker": {
        const markers = doc.markers ?? [];
        if (markers.some((m) => m.id === op.marker.id)) {
          throw new OpError("DUPLICATE_ID", `${name}: marker id "${op.marker.id}" already exists`, opIndex);
        }
        if (markers.length + 1 > LIMITS.markersPerProject) {
          throw new OpError("LIMIT_EXCEEDED", `${name}: a project can have at most ${LIMITS.markersPerProject} markers`, opIndex);
        }
        const index = Math.max(0, Math.min(op.index ?? markers.length, markers.length));
        const marker = { id: op.marker.id, at: op.marker.at, name: op.marker.name };
        doc.markers = [...markers.slice(0, index), marker, ...markers.slice(index)];
        groups.push([{ op: "remove_marker", markerId: marker.id, expect: { marker: { ...marker } } }]);
        break;
      }

      case "update_marker": {
        const marker = doc.markers?.find((m) => m.id === op.markerId);
        if (!marker) throw new OpError("NOT_FOUND", `${name}: marker "${op.markerId}" not found`, opIndex);
        if (op.expect && !holds(marker, op.expect)) throw stale(`marker "${op.markerId}"`);
        const { old, now } = diffFields({ at: marker.at, name: marker.name }, { at: op.patch.at ?? marker.at, name: op.patch.name ?? marker.name });
        if (Object.keys(now).length > 0) groups.push([{ op: "update_marker", markerId: marker.id, patch: old, expect: now }]);
        Object.assign(marker, now);
        break;
      }

      case "remove_marker": {
        const marker = doc.markers?.find((m) => m.id === op.markerId);
        if (!marker) throw new OpError("NOT_FOUND", `${name}: marker "${op.markerId}" not found`, opIndex);
        if (op.expect && !isEqual(op.expect.marker, marker)) throw stale(`marker "${op.markerId}"`);
        const index = (doc.markers ?? []).indexOf(marker);
        const rest = (doc.markers ?? []).filter((m) => m.id !== op.markerId);
        if (rest.length) doc.markers = rest;
        else delete doc.markers;
        groups.push([{ op: "add_marker", marker: { ...marker }, index }]);
        break;
      }

      case "add_lut": {
        const luts = doc.luts ?? [];
        if (luts.some((l) => l.id === op.lut.id)) {
          throw new OpError("DUPLICATE_ID", `${name}: look-up table id "${op.lut.id}" already exists`, opIndex);
        }
        if (luts.length + 1 > LIMITS.lutsPerProject) {
          throw new OpError("LIMIT_EXCEEDED", `${name}: a project can have at most ${LIMITS.lutsPerProject} look-up tables`, opIndex);
        }
        const index = Math.max(0, Math.min(op.index ?? luts.length, luts.length));
        const lut = { id: op.lut.id, name: op.lut.name, size: op.lut.size, data: op.lut.data };
        doc.luts = [...luts.slice(0, index), lut, ...luts.slice(index)];
        groups.push([{ op: "remove_lut", lutId: lut.id, expect: { name: lut.name } }]);
        break;
      }

      case "remove_lut": {
        const lut = doc.luts?.find((l) => l.id === op.lutId);
        if (!lut) throw new OpError("NOT_FOUND", `${name}: look-up table "${op.lutId}" not found`, opIndex);
        if (op.expect && op.expect.name !== lut.name) throw stale(`look-up table "${op.lutId}"`);
        const index = (doc.luts ?? []).indexOf(lut);
        const rest = (doc.luts ?? []).filter((l) => l.id !== op.lutId);
        if (rest.length) doc.luts = rest;
        else delete doc.luts;
        groups.push([{ op: "add_lut", lut: { ...lut }, index }]);
        break;
      }

      case "set_caption_style": {
        assertCaptionsUnlocked(doc, opIndex, name);
        if ((op.patch === undefined) === (op.clear === undefined)) {
          throw new OpError("INVALID", `${name}: give either patch or clear, not both and not neither`, opIndex);
        }
        const stored = doc.captions?.style;
        const now: Record<string, unknown> = { ...captionStyleOf(doc) };
        const expected: Record<string, unknown> = { ...op.expect };
        for (const key of Object.keys(expected)) {
          if (expected[key] !== undefined && !isEqual(expected[key], now[key])) throw stale("the caption style");
        }
        if (op.clear) {
          if (!stored) break;
          // The undo puts the whole style back, and expects the default's values that differ from it.
          const dflt: Record<string, unknown> = { ...defaultCaptionStyle(doc) };
          const differing: Record<string, unknown> = {};
          for (const key of Object.keys(dflt)) if (!isEqual(dflt[key], (stored as Record<string, unknown>)[key])) differing[key] = dflt[key];
          groups.push([{ op: "set_caption_style", patch: { ...stored }, expect: differing as Partial<CaptionStyle> }]);
          const captions = { ...doc.captions };
          delete captions.style;
          if (captions.transcripts) doc.captions = captions;
          else delete doc.captions;
          break;
        }
        const next: Record<string, unknown> = { ...now };
        const old: Record<string, unknown> = {};
        const written: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(op.patch ?? {})) {
          if (value === undefined) continue;
          next[key] = value;
          if (!isEqual(now[key], value)) {
            old[key] = now[key];
            written[key] = value;
          }
        }
        const checked = CaptionStyle.safeParse(next);
        if (!checked.success) {
          const issue = checked.error.issues[0];
          throw new OpError("INVALID", `${name}: the caption style is invalid: ${issue.path.join(".")}${issue.path.length ? ": " : ""}${issue.message}`, opIndex);
        }
        if (stored) {
          // Nothing changed: leave the style as it is.
          if (!Object.keys(written).length) break;
          groups.push([{ op: "set_caption_style", patch: old as Partial<CaptionStyle>, expect: written as Partial<CaptionStyle> }]);
        } else {
          // Nothing stored yet: the first patch always stores the style, even one equal to the default, and the way
          // back is to clear it, so "no style" is restored exactly. The expect is every key the patch set.
          const set = Object.fromEntries(Object.entries(op.patch ?? {}).filter(([, v]) => v !== undefined));
          groups.push([{ op: "set_caption_style", clear: true, expect: set as Partial<CaptionStyle> }]);
        }
        doc.captions = { ...doc.captions, style: checked.data };
        break;
      }

      case "set_transcript": {
        assertCaptionsUnlocked(doc, opIndex, name);
        const before = transcriptOf(doc, op.assetId);
        if (op.expect && op.expect.words !== (before?.length ?? null)) throw stale("the captions");
        if (op.words === null && !before) break;
        if (op.words && !before && Object.keys(doc.captions?.transcripts ?? {}).length + 1 > LIMITS.captionFilesPerProject) {
          throw new OpError("LIMIT_EXCEEDED", `${name}: a project can keep words for at most ${LIMITS.captionFilesPerProject} files`, opIndex);
        }
        groups.push([{ op: "set_transcript", assetId: op.assetId, words: before ?? null, expect: { words: op.words?.length ?? null } }]);
        const rest = { ...doc.captions?.transcripts };
        delete rest[op.assetId];
        if (op.words) rest[op.assetId] = structuredClone(op.words);
        setTranscripts(doc, rest);
        break;
      }

      case "splice_caption_words": {
        assertCaptionsUnlocked(doc, opIndex, name);
        const before = transcriptOf(doc, op.assetId);
        if (!before) throw new OpError("NOT_FOUND", `${name}: no words kept for "${op.assetId}"`, opIndex);
        if (op.index + op.remove > before.length) {
          throw new OpError("INVALID", `${name}: ${op.remove} words from ${op.index} is past the ${before.length} words there are`, opIndex);
        }
        const removed = before.slice(op.index, op.index + op.remove);
        if (op.expect && !isEqual(op.expect.words, removed)) throw stale("the captions");
        if (op.text !== undefined && op.remove < 1) throw new OpError("INVALID", `${name}: text needs at least one word to remove`, opIndex);
        // The text form is worked out here, so the inverse is the ordinary explicit splice and undo stays exact.
        const insert = op.text !== undefined ? rewordRun(removed, op.text) : structuredClone(op.insert ?? []);
        const next = [...before.slice(0, op.index), ...insert, ...before.slice(op.index + op.remove)];
        const checked = CaptionWords.safeParse(next);
        if (!checked.success) {
          throw new OpError("INVALID", `${name}: the words are invalid: ${checked.error.issues[0].message}`, opIndex);
        }
        groups.push([
          {
            op: "splice_caption_words",
            assetId: op.assetId,
            index: op.index,
            remove: insert.length,
            insert: removed,
            expect: { words: structuredClone(insert) },
          },
        ]);
        setTranscripts(doc, { ...doc.captions?.transcripts, [op.assetId]: checked.data });
        break;
      }

      default: {
        const unhandled: never = op;
        throw new OpError("INVALID", `Unhandled op: ${JSON.stringify(unhandled)}`, opIndex);
      }
    }
  });

  return { doc, inverse: groups.reverse().flat() };
}
