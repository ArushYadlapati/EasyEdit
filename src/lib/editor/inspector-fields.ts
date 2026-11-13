import type { Clip, OpInput, TimelineDoc } from "@/lib/timeline";
import { stretchOf } from "@/lib/timeline/presets";
import { clipRects, type Sizer } from "./clip-box";
import { trimBounds } from "./media-clips";
import type { Units } from "./settings";
import { fromUnit, showUnit } from "./units";

// The inspector shows times in seconds (snapped to whole frames on the way in), position and size in the unit
// chosen in Settings, and scale and opacity in percent. X and Y are the centre's distance from the frame's left
// and top edges; Width and Height are the drawn size after the crop, before rotation.

export type ClipField =
  | "text"
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
  | "start"
  | "duration";

// The label of the change, for undo and the activity list.
export const FIELD_LABEL: Record<ClipField, string> = {
  text: "text edit",
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
  start: "timing change",
  duration: "timing change",
};

export const WEIGHTS: { value: number; label: string }[] = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

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
// the clip's kept box before scale and stretch (null when it is not measured, or for audio).
export type FieldContext = {
  fps: number;
  frame: { width: number; height: number };
  units: Units;
  box: { width: number; height: number } | null;
  lockAspect: boolean;
};

export type FieldPrefs = { units: Units; lockAspect: boolean };

const PX_LOCKED: FieldPrefs = { units: "px", lockAspect: true };

// The context of a clip in this document. Without prefs, pixels and locked; without a sizer, no box.
export function fieldContext(doc: TimelineDoc, clip: Clip, prefs: FieldPrefs = PX_LOCKED, sizer: Sizer | null = null): FieldContext {
  const kept = sizer ? clipRects(doc, clip, sizer)?.kept : undefined;
  return {
    fps: doc.fps,
    frame: { width: doc.width, height: doc.height },
    units: prefs.units,
    box: kept ? { width: kept.right - kept.left, height: kept.bottom - kept.top } : null,
    lockAspect: prefs.lockAspect,
  };
}

const round = (n: number, places: number) => Number(n.toFixed(places));

// The field's length in project pixels as drawn, or null when it has none.
function lengthPx(clip: Clip, field: "x" | "y" | "width" | "height", ctx: FieldContext): number | null {
  const t = clip.transform;
  if (field === "x") return t.x * ctx.frame.width;
  if (field === "y") return t.y * ctx.frame.height;
  if (!ctx.box) return null;
  return field === "width" ? ctx.box.width * t.scale * stretchOf(t) : ctx.box.height * t.scale;
}

export function clipFieldValue(clip: Clip, field: ClipField, ctx: FieldContext): string {
  const { fps } = ctx;
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
    case "start":
      return (clip.start / fps).toFixed(2);
    case "duration":
      return (clip.duration / fps).toFixed(2);
  }
  if (clip.type !== "text") return "";
  switch (field) {
    case "text":
      return clip.text;
    case "fontSize":
      return oneDecimal(clip.style.fontSize);
    case "fontWeight":
      return String(clip.style.fontWeight);
    case "color":
      return clip.style.color.toLowerCase();
    case "align":
      return clip.style.align;
  }
}

// A size changed by f. Locked, the scale alone, so the shape is kept. Unlocked, Width changes the stretch alone, and
// Height the scale with the stretch against it, so the width stays.
function resize(clip: Clip, field: "width" | "height", f: number, locked: boolean): Record<string, number> {
  const { scale } = clip.transform;
  const stretch = stretchOf(clip.transform);
  if (locked) return { scale: round(scale * f, 4) };
  if (field === "width") return { stretch: round(stretch * f, 4) };
  return { scale: round(scale * f, 4), stretch: round(stretch / f, 4) };
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
  const maxEnd = clip.type === "text" ? undefined : trimBounds(clip, lengthFrames)?.maxEnd;
  const end = Math.min(after, maxEnd ?? Infinity);
  return { min: 1 / fps, max: Math.max(1, end - clip.start) / fps };
}

// The ops that set the field to what was typed: null when it is not valid input, [] when it
// changes nothing. The rules of the change itself (overlaps, locked tracks, what text may hold)
// stay with applyOps. lengthFrames is the length of a media clip's asset in frames, when it is known: a typed
// length then stops at the end of the media, as a trim on the timeline does.
export function clipFieldOps(clip: Clip, field: ClipField, raw: string, ctx: FieldContext, lengthFrames?: number): OpInput[] | null {
  const { fps } = ctx;
  const update = (patch: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: clip.id, patch }];

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
      const maxEnd = clip.type === "text" ? undefined : trimBounds(clip, lengthFrames)?.maxEnd;
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
      if (sizing) return update({ transform: resize(clip, field, typed / now, ctx.lockAspect) });
      return update({ transform: { [field]: round(typed / (field === "x" ? ctx.frame.width : ctx.frame.height), 6) } });
    }
    case "scale": {
      const n = parseNumber(raw);
      return n === null || n <= 0 ? null : update({ transform: { scale: n / 100 } });
    }
    case "rotation": {
      const n = parseNumber(raw);
      return n === null ? null : update({ transform: { rotation: n } });
    }
    case "opacity": {
      const n = parseNumber(raw);
      return n === null ? null : update({ transform: { opacity: clamp(n / 100, 0, 1) } });
    }
  }

  if (clip.type !== "text") return null;
  switch (field) {
    case "text":
      return update({ text: raw });
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
  }
}
