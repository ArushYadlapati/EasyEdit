import { fontWeights, isListedFont, nearestWeight } from "@/lib/brand/fonts";
import type { Clip, Crop, OpInput, TimelineDoc } from "@/lib/timeline";
import { ArrowHead, ArrowHeads, ShapeDash, isMediaClip, type ShapeClip } from "@/lib/timeline";
import { ARROW_DEFAULTS, CURVED_BEND } from "@/lib/timeline/shapes";
import { LIMITS } from "@/lib/limits";
import { effectiveTransform } from "@/lib/timeline/keyframes";
import { NO_CROP, stretchOf } from "@/lib/timeline/presets";
import { CROP_MIN_SHOWN, clipRects, type Sizer } from "./clip-box";
import { clipFrame, writeTransformOps } from "./keyframe-edit";
import { trimBounds } from "./media-clips";
import type { Units } from "./settings";
import { fromUnit, showUnit } from "./units";

// The inspector shows times in seconds (snapped to whole frames on the way in), position and size in the unit
// chosen in Settings, and scale and opacity in percent. X and Y are the centre's distance from the frame's left
// and top edges; Width and Height are the drawn size after the crop, before rotation. Each crop side is the share cut
// from that side, in percent.

export type ClipField =
  | "text"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "color"
  | "align"
  | "x"
  | "y"
  | "width"
  | "height"
  | "scale"
  | "rotation"
  | "opacity"
  | "cropLeft"
  | "cropTop"
  | "cropRight"
  | "cropBottom"
  | "start"
  | "duration"
  // A shape's: its outline (or an arrow's line) colour and width, its fill, dashes and rounding, and an arrow's heads,
  // head look and size, and bend (Path sets it straight or curved; Bend sets how far, in percent of the length).
  | "stroke"
  | "strokeWidth"
  | "fill"
  | "dash"
  | "radius"
  | "heads"
  | "head"
  | "headSize"
  | "path"
  | "bend";

export type CropField = "cropLeft" | "cropTop" | "cropRight" | "cropBottom";

// The label of the change, for undo and the activity list.
export const FIELD_LABEL: Record<ClipField, string> = {
  text: "text edit",
  fontFamily: "style change",
  fontSize: "style change",
  fontWeight: "style change",
  color: "style change",
  align: "style change",
  x: "position change",
  y: "position change",
  width: "size change",
  height: "size change",
  scale: "size change",
  rotation: "position change",
  opacity: "position change",
  cropLeft: "crop",
  cropTop: "crop",
  cropRight: "crop",
  cropBottom: "crop",
  start: "timing change",
  duration: "timing change",
  stroke: "style change",
  strokeWidth: "style change",
  fill: "style change",
  dash: "style change",
  radius: "style change",
  heads: "style change",
  head: "style change",
  headSize: "style change",
  path: "style change",
  bend: "style change",
};

export const WEIGHTS: { value: number; label: string }[] = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

// The names of the weights fonts in the list have, beyond the five above.
const WEIGHT_NAMES: Record<number, string> = { 300: "Light", 800: "Extra bold", ...Object.fromEntries(WEIGHTS.map((w) => [w.value, w.label])) };

// The Weight menu for a clip in this font: the weights a listed font has; for any other font the five above. The
// clip's own weight is added when it is not among them, so the menu always shows what the clip has.
export function weightOptions(family: string, current: number): { value: number; label: string }[] {
  const own = fontWeights(family);
  const options = own ? own.map((value) => ({ value, label: WEIGHT_NAMES[value] ?? String(value) })) : [...WEIGHTS];
  if (!options.some((o) => o.value === current)) options.push({ value: current, label: WEIGHT_NAMES[current] ?? String(current) });
  return options.sort((a, b) => a.value - b.value);
}

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 1000;
const ALIGNS = ["left", "center", "right"] as const;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// At most one decimal, without a trailing ".0" ("33.3", "50").
const oneDecimal = (n: number) => String(Number(n.toFixed(1)) || 0);

// An optional sign, digits and an optional decimal part ("12", "-0.5", ".5", "2."). Not "0x10" or "1e2".
const PLAIN_DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  return PLAIN_DECIMAL.test(text) ? Number(text) : null;
}

// What a field is shown and changed against: the project's rate and frame, this browser's unit and lock, and
// the clip's kept box before scale and stretch (null when it is not measured, or for audio). playhead: the timeline
// frame the fields show and edit; keyframed properties read their value there and a change keys it there. Without
// it, fields read and write the transform alone.
export type FieldContext = {
  fps: number;
  frame: { width: number; height: number };
  units: Units;
  box: { width: number; height: number } | null;
  lockAspect: boolean;
  playhead?: number;
};

export type FieldPrefs = { units: Units; lockAspect: boolean };

const PX_LOCKED: FieldPrefs = { units: "px", lockAspect: true };

// The context of a clip in this document. Without prefs, pixels and locked; without a sizer, no box.
export function fieldContext(doc: TimelineDoc, clip: Clip, prefs: FieldPrefs = PX_LOCKED, sizer: Sizer | null = null, playhead?: number): FieldContext {
  const kept = sizer ? clipRects(doc, clip, sizer)?.kept : undefined;
  return {
    fps: doc.fps,
    frame: { width: doc.width, height: doc.height },
    units: prefs.units,
    box: kept ? { width: kept.right - kept.left, height: kept.bottom - kept.top } : null,
    lockAspect: prefs.lockAspect,
    ...(playhead === undefined ? {} : { playhead }),
  };
}

// The clip as the fields show it: its keyframed properties at the playhead, inside the clip.
function shownAt(clip: Clip, ctx: FieldContext): Clip {
  if (ctx.playhead === undefined) return clip;
  const transform = effectiveTransform(clip, clipFrame(clip, ctx.playhead));
  return transform === clip.transform ? clip : ({ ...clip, transform } as Clip);
}

const round = (n: number, places: number) => Number(n.toFixed(places));

// Each crop field's side, and the side across from it.
const CROP_SIDES: Record<CropField, { side: keyof Crop; opposite: keyof Crop }> = {
  cropLeft: { side: "left", opposite: "right" },
  cropTop: { side: "top", opposite: "bottom" },
  cropRight: { side: "right", opposite: "left" },
  cropBottom: { side: "bottom", opposite: "top" },
};

// The most a side may cut, as a share: what leaves CROP_MIN_SHOWN against the opposite side. Below 0 when the
// opposite side already leaves less, as a crop made elsewhere may.
function cropRoom(crop: Crop, field: CropField): number {
  return 1 - crop[CROP_SIDES[field].opposite] - CROP_MIN_SHOWN;
}

// How far a drag on a crop side may go, in percent, from the crop as it is.
export function cropScrubRange(clip: Clip, field: CropField): { min: number; max: number } {
  return { min: 0, max: Math.max(0, round(cropRoom(clip.transform.crop ?? NO_CROP, field) * 100, 4)) };
}

// The field's length in project pixels as drawn, or null when it has none.
function lengthPx(clip: Clip, field: "x" | "y" | "width" | "height", ctx: FieldContext): number | null {
  const t = clip.transform;
  if (field === "x") return t.x * ctx.frame.width;
  if (field === "y") return t.y * ctx.frame.height;
  if (!ctx.box) return null;
  return field === "width" ? ctx.box.width * t.scale * stretchOf(t) : ctx.box.height * t.scale;
}

export function clipFieldValue(saved: Clip, field: ClipField, ctx: FieldContext): string {
  const { fps } = ctx;
  const clip = shownAt(saved, ctx);
  switch (field) {
    case "x":
    case "y":
    case "width":
    case "height": {
      const px = lengthPx(clip, field, ctx);
      return px === null ? "" : showUnit(px, ctx.units);
    }
    case "scale":
    case "opacity":
      return oneDecimal(clip.transform[field] * 100);
    case "rotation":
      return oneDecimal(clip.transform.rotation);
    case "cropLeft":
    case "cropTop":
    case "cropRight":
    case "cropBottom":
      return oneDecimal((clip.transform.crop ?? NO_CROP)[CROP_SIDES[field].side] * 100);
    case "start":
      return (clip.start / fps).toFixed(2);
    case "duration":
      return (clip.duration / fps).toFixed(2);
  }
  if (clip.type === "shape") return shapeFieldValue(clip, field);
  if (clip.type !== "text") return "";
  switch (field) {
    case "text":
      return clip.text;
    case "fontFamily":
      return clip.style.fontFamily;
    case "fontSize":
      return oneDecimal(clip.style.fontSize);
    case "fontWeight":
      return String(clip.style.fontWeight);
    case "color":
      return clip.style.color.toLowerCase();
    case "align":
      return clip.style.align;
    default:
      return "";
  }
}

function shapeFieldValue(clip: ShapeClip, field: ClipField): string {
  switch (field) {
    case "stroke":
      return (clip.stroke ?? "").toLowerCase();
    case "fill":
      return (clip.fill ?? "").toLowerCase();
    case "strokeWidth":
      return oneDecimal(clip.strokeWidth);
    case "dash":
      return clip.dash;
    case "radius":
      return oneDecimal(clip.radius ?? 0);
    case "heads":
      return clip.heads ?? ARROW_DEFAULTS.heads;
    case "head":
      return clip.head ?? ARROW_DEFAULTS.head;
    case "headSize":
      return oneDecimal(clip.headSize ?? ARROW_DEFAULTS.headSize);
    case "path":
      return (clip.bend ?? 0) === 0 ? "straight" : "curved";
    case "bend":
      return oneDecimal((clip.bend ?? 0) * 100);
    default:
      return "";
  }
}

// A shape's own field, set to what was typed or picked. A colour may be cleared (""), when the shape still shows
// something: a box keeps an outline or a fill, an arrow always has its line.
function shapeFieldOps(clip: ShapeClip, field: ClipField, raw: string): OpInput[] | null {
  const update = (patch: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: clip.id, patch }];
  const number = (lo: number, hi: number, places = 1) => {
    const n = parseNumber(raw);
    return n === null ? null : round(clamp(n, lo, hi), places);
  };
  const box = clip.shape !== "arrow";
  switch (field) {
    case "stroke":
    case "fill": {
      const color = raw.trim().toLowerCase();
      if (color === "") {
        if (field === "fill" ? !box || !clip.stroke : !box || !clip.fill) return null;
        return (field === "fill" ? clip.fill : clip.stroke) == null ? [] : update({ [field]: null });
      }
      if (field === "fill" && !box) return null;
      return HEX_COLOR.test(color) ? update({ [field]: color }) : null;
    }
    case "strokeWidth": {
      const n = number(1, LIMITS.shapeStrokeMax);
      return n === null ? null : n === clip.strokeWidth ? [] : update({ strokeWidth: n });
    }
    case "dash": {
      const dash = ShapeDash.safeParse(raw);
      return dash.success ? update({ dash: dash.data }) : null;
    }
    case "radius": {
      if (clip.shape !== "rect") return null;
      const n = number(0, Math.min(clip.width, clip.height) / 2);
      return n === null ? null : update({ radius: n });
    }
    case "heads":
    case "head": {
      if (box) return null;
      const parsed = (field === "heads" ? ArrowHeads : ArrowHead).safeParse(raw);
      return parsed.success ? update({ [field]: parsed.data }) : null;
    }
    case "headSize": {
      if (box) return null;
      const n = number(1, 8);
      return n === null ? null : update({ headSize: n });
    }
    case "path": {
      if (box || (raw !== "straight" && raw !== "curved")) return null;
      const straight = (clip.bend ?? 0) === 0;
      if (raw === "straight") return straight ? [] : update({ bend: 0 });
      return straight ? update({ bend: CURVED_BEND }) : [];
    }
    case "bend": {
      if (box) return null;
      const n = number(-50, 50);
      return n === null ? null : update({ bend: round(n / 100, 3) });
    }
    default:
      return null;
  }
}

// A shape's size changed to typed (project pixels as drawn): its own width or height at its scale, so its outline
// keeps its thickness. Locked, a box keeps its shape. An arrow has a length (its width) and no height.
function resizeShape(clip: ShapeClip, field: "width" | "height", typed: number, locked: boolean): OpInput[] | null {
  const s = clip.transform.scale;
  const update = (patch: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: clip.id, patch }];
  if (clip.shape === "arrow") return field === "width" ? update({ width: round(Math.min(LIMITS.shapeSideMax, typed / s), 2) }) : null;
  const own = round(Math.min(LIMITS.shapeSideMax, typed / s), 2);
  const f = own / clip[field];
  if (!locked) return update({ [field]: own });
  const other = field === "width" ? "height" : "width";
  return update({ [field]: own, [other]: round(Math.min(LIMITS.shapeSideMax, Math.max(1, clip[other] * f)), 2) });
}

// A size changed by f. Locked, the scale alone, so the shape is kept. Unlocked, Width changes the stretch alone, and
// Height the scale with the stretch against it, so the width stays.
function resize(clip: Clip, field: "width" | "height", f: number, locked: boolean): Record<string, number> {
  const { scale } = clip.transform;
  const stretch = stretchOf(clip.transform);
  if (locked) return { scale: round(scale * f, 4) };
  if (field === "width") return { stretch: round(stretch * f, 4) };
  // The stretch is worked out from the rounded scale, so their rounding does not move the width.
  const s2 = round(scale * f, 4);
  return { scale: s2, stretch: s2 === 0 ? round(stretch / f, 4) : round((stretch * scale) / s2, 4) };
}

// How far a drag on Start or Length may take the clip, in seconds, so a drag slides up to a neighbour and stops there.
// Start runs from the end of the clip before it on its track (else 0) to where its end meets the clip after it (else
// without end). Length runs from one frame to the clip after it, or the end of the media when that comes first.
// lengthFrames is the media's length in frames, when it is known. Typing keeps its own checks.
export function scrubBounds(doc: TimelineDoc, clipId: string, field: "start" | "duration", lengthFrames?: number): { min: number; max: number } {
  const track = doc.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) return { min: -Infinity, max: Infinity };
  const others = track.clips.filter((c) => c.id !== clip.id);
  const before = Math.max(0, ...others.filter((c) => c.start < clip.start).map((c) => c.start + c.duration));
  const after = Math.min(Infinity, ...others.filter((c) => c.start > clip.start).map((c) => c.start));
  const { fps } = doc;
  if (field === "start") return { min: before / fps, max: (after - clip.duration) / fps };
  const maxEnd = !isMediaClip(clip) ? undefined : trimBounds(clip, lengthFrames)?.maxEnd;
  const end = Math.min(after, maxEnd ?? Infinity);
  return { min: 1 / fps, max: Math.max(1, end - clip.start) / fps };
}

// The ops that set the field to what was typed: null when it is not valid input, [] when it
// changes nothing. The rules of the change itself (overlaps, locked tracks, what text may hold)
// stay with applyOps. lengthFrames is the length of a media clip's asset in frames, when it is known: a typed
// length then stops at the end of the media, as a trim on the timeline does.
export function clipFieldOps(saved: Clip, field: ClipField, raw: string, ctx: FieldContext, lengthFrames?: number): OpInput[] | null {
  const { fps, playhead } = ctx;
  const clip = shownAt(saved, ctx);
  const update = (patch: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: clip.id, patch }];
  // Position, size, turn and opacity key a keyframed property at the playhead instead of setting the transform.
  const place = (transform: Record<string, unknown>): OpInput[] =>
    playhead === undefined ? update({ transform }) : writeTransformOps(saved, clipFrame(saved, playhead), transform);

  switch (field) {
    case "start": {
      const seconds = parseNumber(raw);
      if (seconds === null || seconds < 0) return null;
      const start = Math.max(0, Math.round(seconds * fps));
      return start === clip.start ? [] : [{ op: "move_clip", clipId: clip.id, start }];
    }
    case "duration": {
      const seconds = parseNumber(raw);
      if (seconds === null) return null;
      const duration = Math.max(1, Math.round(seconds * fps));
      const maxEnd = !isMediaClip(clip) ? undefined : trimBounds(clip, lengthFrames)?.maxEnd;
      const to = maxEnd === undefined ? clip.start + duration : Math.max(clip.start + 1, Math.min(clip.start + duration, maxEnd));
      return to === clip.start + clip.duration ? [] : [{ op: "trim_clip", clipId: clip.id, edge: "end", to }];
    }
    case "x":
    case "y":
    case "width":
    case "height": {
      const n = parseNumber(raw);
      const now = lengthPx(clip, field, ctx);
      if (n === null || now === null) return null;
      const sizing = field === "width" || field === "height";
      if (sizing && (n <= 0 || now <= 0)) return null;
      const typed = fromUnit(n, ctx.units);
      // A value typed as it is shown (the rounded number) never nudges the clip.
      if (showUnit(typed, ctx.units) === showUnit(now, ctx.units)) return [];
      if (sizing && clip.type === "shape") return resizeShape(clip, field, typed, ctx.lockAspect);
      if (sizing) return place(resize(clip, field, typed / now, ctx.lockAspect));
      return place({ [field]: round(typed / (field === "x" ? ctx.frame.width : ctx.frame.height), 6) });
    }
    case "scale": {
      const n = parseNumber(raw);
      const scale = n === null ? 0 : round(n / 100, 4);
      return scale <= 0 ? null : place({ scale });
    }
    case "rotation": {
      const n = parseNumber(raw);
      return n === null ? null : place({ rotation: n });
    }
    case "opacity": {
      const n = parseNumber(raw);
      return n === null ? null : place({ opacity: clamp(round(n / 100, 4), 0, 1) });
    }
    case "cropLeft":
    case "cropTop":
    case "cropRight":
    case "cropBottom": {
      const n = parseNumber(raw);
      if (n === null) return null;
      const crop = clip.transform.crop ?? NO_CROP;
      const { side } = CROP_SIDES[field];
      const value = Math.max(0, round(clamp(n / 100, 0, cropRoom(crop, field)), 4));
      // update_clip replaces the crop whole, so all four sides go.
      return value === crop[side] ? [] : update({ transform: { crop: { ...crop, [side]: value } } });
    }
  }

  if (clip.type === "shape") return shapeFieldOps(clip, field, raw);
  if (clip.type !== "text") return null;
  switch (field) {
    case "text":
      return update({ text: raw });
    case "fontFamily": {
      // A font from the list, at the weight nearest the clip's that it has. A font the clip already has (even one not
      // in the list, as an agent may write) changes nothing.
      if (raw === clip.style.fontFamily) return [];
      if (!isListedFont(raw)) return null;
      const fontWeight = nearestWeight(raw, clip.style.fontWeight);
      return update({ style: fontWeight === clip.style.fontWeight ? { fontFamily: raw } : { fontFamily: raw, fontWeight } });
    }
    case "fontSize": {
      const n = parseNumber(raw);
      return n === null ? null : update({ style: { fontSize: clamp(Math.round(n), FONT_SIZE_MIN, FONT_SIZE_MAX) } });
    }
    case "fontWeight": {
      const n = parseNumber(raw);
      return n === null ? null : update({ style: { fontWeight: Math.round(n) } });
    }
    case "color": {
      const color = raw.trim();
      return HEX_COLOR.test(color) ? update({ style: { color: color.toLowerCase() } }) : null;
    }
    case "align": {
      const align = ALIGNS.find((a) => a === raw);
      return align ? update({ style: { align } }) : null;
    }
    default:
      return null;
  }
}
