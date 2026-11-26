import { fontWeights, isListedFont, nearestWeight } from "@/lib/brand/fonts";
import type { Clip, Crop, Mask, OpInput, TimelineDoc } from "@/lib/timeline";
import { ArrowHead, ArrowHeads, BlendMode, LOOKS, ShapeDash, VOLUME_MAX, adjustOf, isColorClip, isMediaClip, lookMatch, lookPatch, type AdjustKey, type MediaClip, type ShapeClip, type TextClip } from "@/lib/timeline";
import { ARROW_DEFAULTS, CURVED_BEND, arrowThrough, takesRadius } from "@/lib/timeline/shapes";
import { BACKGROUND_START, hasBackground, hasOutline, hasShadow, outlineStart, shadowStart, textExtras } from "@/lib/timeline/text-style";
import { straightenOps } from "./arrow-drag";
import { LIMITS } from "@/lib/limits";
import { CHROMA_START } from "@/lib/render/chroma";
import { wheelOf, wheelOps } from "./grade";
import { adjustAt, effectiveTransform, volumeAt } from "@/lib/timeline/keyframes";
import { NO_CROP, stretchOf } from "@/lib/timeline/presets";
import { CROP_MIN_SHOWN, clipRects, type Sizer } from "./clip-box";
import { clipFrame, writeAdjustOps, writeTransformOps, writeVolumeOps } from "./keyframe-edit";
import { trimBounds } from "./media-clips";
import { SPEED_MAX, SPEED_MIN, hasSpeed, rateOf, roomAfter, speedOps } from "./speed";
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
  // A text's optional look. Italic, Underline, Outline, Shadow and Background are "on" or "off"; the room between
  // letters and the background's padding and rounding are percents of the font size, the line height a multiple of it,
  // and the outline's width and the shadow's blur and offsets project pixels.
  | "italic"
  | "underline"
  | "letterSpacing"
  | "lineHeight"
  | "outline"
  | "outlineColor"
  | "outlineWidth"
  | "shadow"
  | "shadowColor"
  | "shadowBlur"
  | "shadowX"
  | "shadowY"
  | "shadowOpacity"
  | "background"
  | "backgroundColor"
  | "backgroundOpacity"
  | "backgroundPadding"
  | "backgroundRadius"
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
  // A video or audio clip's sound: how loud, in percent of as recorded, and the seconds it fades in and out over.
  | "volume"
  | "fadeIn"
  | "fadeOut"
  // Where the clip's sound sits: −100 all the way left, 0 as recorded, 100 all the way right.
  | "pan"
  // The clip's sound clean-up: the rumble filter ("on" or "off"), the noise gate, the compressor and the noise
  // reduction in percent of full strength, and three tone bands in decibels.
  | "soundLowCut"
  | "soundGate"
  | "soundCompress"
  | "soundDenoise"
  | "soundBass"
  | "soundMid"
  | "soundTreble"
  // How fast a video or audio clip plays, in percent of as recorded, whichever way it runs.
  | "speed"
  // Where in its file a video or audio clip starts, in seconds: changing it slips the footage under the clip, which
  // keeps its place and length.
  | "sourceIn"
  // A video's or image's colours, in percent of their full swing, its hue in degrees and its blur in project pixels;
  // whether it is mirrored ("on" or "off"); and how a clip mixes with what is under it.
  | "brightness"
  | "contrast"
  | "saturation"
  | "temperature"
  | "vignette"
  | "hue"
  | "blur"
  // Its stylised effects, in percent of full strength, and the side of a pixelated picture's blocks in project pixels.
  | "sharpen"
  | "grain"
  | "pixelate"
  | "split"
  | "glitch"
  | "vhs"
  // Its grade: each colour wheel's brightness slider, −100 to 100, and how much of its look-up table is mixed in, in
  // percent.
  | "liftLevel"
  | "gammaLevel"
  | "gainLevel"
  | "lutAmount"
  // How much of the picture's look is on, in percent of the whole look. A picture with no look has none.
  | "lookStrength"
  | "flipH"
  | "flipV"
  | "blend"
  // How round a video's or image's corners are, in percent, and its green screen: on or off, the colour taken out,
  // and how near that colour a pixel must be (tolerance) and how softly the edge fades (softness), in percent.
  | "rounding"
  | "chroma"
  | "chromaColor"
  | "chromaTolerance"
  | "chromaSoftness"
  // A picture's or adjustment layer's mask: on or off, its shape, where its middle sits and how large it is in
  // percent of the picture, how soft its edge is in percent, and whether it is turned inside out ("on" or "off").
  | "mask"
  | "maskShape"
  | "maskX"
  | "maskY"
  | "maskWidth"
  | "maskHeight"
  | "maskFeather"
  | "maskInvert"
  // A shape's: its outline (or an arrow's line) colour and width, its fill, dashes and rounding, and an arrow's heads,
  // head look and size, and its path: Path sets it straight or curved, and Bend, on a line with one point, how far to
  // the side that point sits, in percent of the length.
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
  italic: "style change",
  underline: "style change",
  letterSpacing: "style change",
  lineHeight: "style change",
  outline: "style change",
  outlineColor: "style change",
  outlineWidth: "style change",
  shadow: "style change",
  shadowColor: "style change",
  shadowBlur: "style change",
  shadowX: "style change",
  shadowY: "style change",
  shadowOpacity: "style change",
  background: "style change",
  backgroundColor: "style change",
  backgroundOpacity: "style change",
  backgroundPadding: "style change",
  backgroundRadius: "style change",
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
  volume: "volume change",
  fadeIn: "fade change",
  fadeOut: "fade change",
  pan: "pan change",
  soundLowCut: "sound clean-up",
  soundGate: "sound clean-up",
  soundCompress: "sound clean-up",
  soundDenoise: "sound clean-up",
  soundBass: "sound clean-up",
  soundMid: "sound clean-up",
  soundTreble: "sound clean-up",
  speed: "speed change",
  sourceIn: "slip",
  brightness: "color change",
  contrast: "color change",
  saturation: "color change",
  temperature: "color change",
  vignette: "color change",
  hue: "color change",
  blur: "color change",
  sharpen: "effect change",
  grain: "effect change",
  pixelate: "effect change",
  split: "effect change",
  glitch: "effect change",
  vhs: "effect change",
  lookStrength: "color look",
  liftLevel: "color grade",
  gammaLevel: "color grade",
  gainLevel: "color grade",
  lutAmount: "color grade",
  flipH: "flip",
  flipV: "flip",
  blend: "blend change",
  rounding: "style change",
  chroma: "green screen",
  chromaColor: "green screen",
  chromaTolerance: "green screen",
  chromaSoftness: "green screen",
  mask: "mask",
  maskShape: "mask",
  maskX: "mask",
  maskY: "mask",
  maskWidth: "mask",
  maskHeight: "mask",
  maskFeather: "mask",
  maskInvert: "mask",
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
export const SPEED_PERCENT = { min: SPEED_MIN * 100, max: SPEED_MAX * 100 };

// What each colour field takes as typed; per: what one of the document's own units is in typed ones.
export const ADJUST_RANGE: Record<AdjustKey, { min: number; max: number; per: number }> = {
  brightness: { min: -100, max: 100, per: 100 },
  contrast: { min: -100, max: 100, per: 100 },
  saturation: { min: -100, max: 100, per: 100 },
  temperature: { min: -100, max: 100, per: 100 },
  vignette: { min: 0, max: 100, per: 100 },
  hue: { min: -180, max: 180, per: 1 },
  blur: { min: 0, max: 200, per: 1 },
  sharpen: { min: 0, max: 100, per: 100 },
  grain: { min: 0, max: 100, per: 100 },
  pixelate: { min: 0, max: 200, per: 1 },
  split: { min: 0, max: 100, per: 100 },
  glitch: { min: 0, max: 100, per: 100 },
  vhs: { min: 0, max: 100, per: 100 },
};

// The frames of its file a clip may start on and still fit it, at its length, speed and way round. Without the
// media's length, any frame from 0.
export function slipRange(clip: MediaClip, lengthFrames?: number): { min: number; max: number } {
  if (lengthFrames === undefined) return { min: 0, max: Infinity };
  const used = Math.abs(Math.round(clip.duration * clip.speed));
  if (clip.speed > 0) return { min: 0, max: Math.max(0, lengthFrames - used) };
  if (clip.speed < 0) return { min: Math.max(0, used - 1), max: Math.max(0, lengthFrames - 1) };
  return { min: 0, max: Math.max(0, lengthFrames - 1) };
}

// A clip with a picture of its own to colour and mirror: a video or an image.
const LEVEL_WHEEL = { liftLevel: "lift", gammaLevel: "gamma", gainLevel: "gain" } as const;

// What turning a mask on starts from: an ellipse in the middle, over a little more than half the picture, with a
// slightly soft edge.
export const MASK_START: Mask = { shape: "ellipse", x: 0.5, y: 0.5, width: 0.6, height: 0.6, feather: 0.1 };
const MASK_PART = { maskX: "x", maskY: "y", maskWidth: "width", maskHeight: "height", maskFeather: "feather" } as const;
// What each mask number takes as typed, in percent.
export const MASK_RANGE: Record<keyof typeof MASK_PART, { min: number; max: number }> = {
  maskX: { min: -100, max: 200 },
  maskY: { min: -100, max: 200 },
  maskWidth: { min: 1, max: 300 },
  maskHeight: { min: 1, max: 300 },
  maskFeather: { min: 0, max: 100 },
};

function isPicture(clip: Clip): clip is MediaClip & { type: "video" | "image" } {
  return clip.type === "video" || clip.type === "image";
}

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
  room?: number; // the frames from the clip's start to the next clip on its track: how long it can get
};

export type FieldPrefs = { units: Units; lockAspect: boolean };

const PX_LOCKED: FieldPrefs = { units: "px", lockAspect: true };

// The context of a clip in this document. Without prefs, pixels and locked; without a sizer, no box.
export function fieldContext(doc: TimelineDoc, clip: Clip, prefs: FieldPrefs = PX_LOCKED, sizer: Sizer | null = null, playhead?: number): FieldContext {
  const kept = sizer ? clipRects(doc, clip, sizer)?.kept : undefined;
  const track = doc.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
  return {
    fps: doc.fps,
    frame: { width: doc.width, height: doc.height },
    units: prefs.units,
    box: kept ? { width: kept.right - kept.left, height: kept.bottom - kept.top } : null,
    lockAspect: prefs.lockAspect,
    ...(playhead === undefined ? {} : { playhead }),
    ...(track && { room: roomAfter(track, clip) }),
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

// The part of a clip's sound clean-up each number field sets, and how far a tone band turns, in decibels.
const SOUND_PART = { soundGate: "gate", soundCompress: "compress", soundDenoise: "denoise", soundBass: "bass", soundMid: "mid", soundTreble: "treble" } as const;
export const TONE_DB = 12;

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
    case "volume":
      // A keyframed volume shows what it is at the playhead.
      // A nest's volume is one number, on top of each of its clips' own.
      if (saved.type === "nest") return String(Math.round(saved.volume * 100));
      return saved.type === "video" || saved.type === "audio" ? String(Math.round((ctx.playhead === undefined ? saved.volume : volumeAt(saved, clipFrame(saved, ctx.playhead))) * 100)) : "";
    case "fadeIn":
    case "fadeOut":
      return clip.type === "video" || clip.type === "audio" ? ((clip[field] ?? 0) / fps).toFixed(2) : "";
    case "pan":
      return hasSpeed(clip) ? String(Math.round((clip.pan ?? 0) * 100)) : "";
    case "soundLowCut":
      return hasSpeed(clip) ? (clip.sound?.lowCut ? "on" : "off") : "";
    case "soundGate":
    case "soundCompress":
    case "soundDenoise":
      return hasSpeed(clip) ? String(Math.round((clip.sound?.[SOUND_PART[field]] ?? 0) * 100)) : "";
    case "soundBass":
    case "soundMid":
    case "soundTreble":
      return hasSpeed(clip) ? oneDecimal(clip.sound?.[SOUND_PART[field]] ?? 0) : "";
    case "speed":
      return hasSpeed(clip) ? String(Math.round(rateOf(clip) * 100)) : "";
    case "sourceIn":
      return hasSpeed(clip) ? (clip.in / fps).toFixed(2) : "";
    case "brightness":
    case "contrast":
    case "saturation":
    case "temperature":
    case "vignette":
    case "hue":
    case "blur":
    case "sharpen":
    case "grain":
    case "pixelate":
    case "split":
    case "glitch":
    case "vhs":
      // A keyframed one shows what it is at the playhead.
      return isColorClip(saved) ? oneDecimal((ctx.playhead === undefined ? adjustOf(saved.adjust) : adjustAt(saved, clipFrame(saved, ctx.playhead)))[field] * ADJUST_RANGE[field].per) : "";
    case "liftLevel":
    case "gammaLevel":
    case "gainLevel":
      return isColorClip(clip) ? oneDecimal(wheelOf(clip.grade, LEVEL_WHEEL[field]).level * 100) : "";
    case "lutAmount":
      return isColorClip(clip) && clip.grade?.lut ? oneDecimal((clip.grade.lutAmount ?? 1) * 100) : "";
    case "mask":
      return isColorClip(clip) ? (clip.mask ? "on" : "off") : "";
    case "maskShape":
      return isColorClip(clip) && clip.mask ? clip.mask.shape : "";
    case "maskInvert":
      return isColorClip(clip) && clip.mask ? (clip.mask.invert ? "on" : "off") : "";
    case "maskX":
    case "maskY":
    case "maskWidth":
    case "maskHeight":
    case "maskFeather":
      return isColorClip(clip) && clip.mask ? oneDecimal(clip.mask[MASK_PART[field]] * 100) : "";
    case "lookStrength": {
      const look = isColorClip(clip) ? lookMatch(clip.adjust) : null;
      return look && look.id !== "none" ? oneDecimal(look.strength * 100) : "";
    }
    case "flipH":
    case "flipV":
      return isPicture(clip) ? (clip.transform[field] ? "on" : "off") : "";
    case "blend":
      return clip.type === "audio" || clip.type === "placeholder" || clip.type === "adjustment" ? "" : (clip.blend ?? "normal");
    case "rounding":
      return isPicture(clip) ? oneDecimal((clip.rounding ?? 0) * 100) : "";
    case "chroma":
      return isPicture(clip) ? (clip.chroma ? "on" : "off") : "";
    case "chromaColor":
      return isPicture(clip) ? (clip.chroma?.color ?? "").toLowerCase() : "";
    case "chromaTolerance":
    case "chromaSoftness":
      return isPicture(clip) && clip.chroma ? oneDecimal(clip.chroma[field === "chromaTolerance" ? "tolerance" : "softness"] * 100) : "";
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
      return textLookValue(clip, field);
  }
}

const onOff = (on: boolean) => (on ? "on" : "off");

// A text's optional look, as its fields show it. A colour that is off shows as "".
function textLookValue(clip: TextClip, field: ClipField): string {
  const look = textExtras(clip.style);
  switch (field) {
    case "italic":
    case "underline":
      return onOff(look[field]);
    case "outline":
      return onOff(hasOutline(look));
    case "shadow":
      return onOff(hasShadow(look));
    case "background":
      return onOff(hasBackground(look));
    case "outlineColor":
    case "shadowColor":
    case "backgroundColor":
      return (look[field] ?? "").toLowerCase();
    case "letterSpacing":
    case "shadowOpacity":
    case "backgroundOpacity":
    case "backgroundPadding":
    case "backgroundRadius":
      return oneDecimal(look[field] * 100);
    case "lineHeight":
      return String(Number(look.lineHeight.toFixed(2)));
    case "outlineWidth":
    case "shadowBlur":
    case "shadowX":
    case "shadowY":
      return oneDecimal(look[field]);
    default:
      return "";
  }
}

type LookNumber = "letterSpacing" | "lineHeight" | "outlineWidth" | "shadowBlur" | "shadowX" | "shadowY" | "shadowOpacity" | "backgroundOpacity" | "backgroundPadding" | "backgroundRadius";

// What each number of a text's look may be, as it is typed (percents, multiples and pixels); per: what one of the style's
// own units is in typed ones; places: the decimals the style keeps.
const LOOK_NUMBERS: Record<LookNumber, { min: number; max: number; per: number; places: number }> = {
  letterSpacing: { min: -20, max: 200, per: 100, places: 3 },
  lineHeight: { min: 0.5, max: 4, per: 1, places: 2 },
  outlineWidth: { min: 0, max: 200, per: 1, places: 1 },
  shadowBlur: { min: 0, max: 400, per: 1, places: 1 },
  shadowX: { min: -1000, max: 1000, per: 1, places: 1 },
  shadowY: { min: -1000, max: 1000, per: 1, places: 1 },
  shadowOpacity: { min: 0, max: 100, per: 100, places: 3 },
  backgroundOpacity: { min: 0, max: 100, per: 100, places: 3 },
  backgroundPadding: { min: 0, max: 300, per: 100, places: 3 },
  backgroundRadius: { min: 0, max: 200, per: 100, places: 3 },
};

const isLookNumber = (field: ClipField): field is LookNumber => Object.hasOwn(LOOK_NUMBERS, field);

// The least and most a look number's field takes, as typed; null for any other field.
export function lookRange(field: ClipField): { min: number; max: number } | null {
  return isLookNumber(field) ? { min: LOOK_NUMBERS[field].min, max: LOOK_NUMBERS[field].max } : null;
}

// A text's optional look, set to what was typed or picked. Turning an outline, a shadow or a background on gives it a
// colour (and, the first time, a size that suits the text); turning it off takes only the colour away, so turning it
// on again brings the same look back.
function textLookOps(clip: TextClip, field: ClipField, raw: string): OpInput[] | null {
  const style = (patch: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: clip.id, patch: { style: patch } }];
  const look = textExtras(clip.style);
  if (isLookNumber(field)) {
    const range = LOOK_NUMBERS[field];
    const n = parseNumber(raw);
    if (n === null) return null;
    const value = round(clamp(n, range.min, range.max) / range.per, range.places);
    return value === look[field] ? [] : style({ [field]: value });
  }
  const on = raw === "on";
  switch (field) {
    case "italic":
    case "underline":
      if (raw !== "on" && raw !== "off") return null;
      return on === look[field] ? [] : style({ [field]: on });
    case "outline":
      if (raw !== "on" && raw !== "off") return null;
      if (on === hasOutline(look)) return [];
      if (!on) return style({ outlineColor: null });
      return style(look.outlineWidth > 0 ? { outlineColor: outlineStart(clip.style.fontSize).outlineColor } : outlineStart(clip.style.fontSize));
    case "shadow":
      if (raw !== "on" && raw !== "off") return null;
      if (on === hasShadow(look)) return [];
      if (!on) return style({ shadowColor: null });
      // A shadow that was never set up gets one that suits the text; one that was keeps its blur and offsets.
      if (clip.style.shadowBlur === undefined && clip.style.shadowY === undefined) return style(shadowStart(clip.style.fontSize));
      return style({ shadowColor: "#000000", ...(look.shadowOpacity === 0 && { shadowOpacity: 0.6 }) });
    case "background":
      if (raw !== "on" && raw !== "off") return null;
      if (on === hasBackground(look)) return [];
      if (!on) return style({ backgroundColor: null });
      return style(clip.style.backgroundOpacity === undefined || look.backgroundOpacity === 0 ? BACKGROUND_START : { backgroundColor: BACKGROUND_START.backgroundColor });
    case "outlineColor":
    case "shadowColor":
    case "backgroundColor": {
      const color = raw.trim().toLowerCase();
      if (!HEX_COLOR.test(color)) return null;
      return color === look[field] ? [] : style({ [field]: color });
    }
    default:
      return null;
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
      return arrowThrough(clip).length === 0 ? "straight" : "curved";
    case "bend": {
      const through = arrowThrough(clip);
      return through.length === 1 ? oneDecimal(through[0].y * 100) : "";
    }
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
      if (!takesRadius(clip.shape)) return null;
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
      if (raw === "straight") return straightenOps(clip);
      // Curved gives a straight line its first point, out to one side of its middle; the preview's handles take it from there.
      return arrowThrough(clip).length === 0 ? update({ points: [{ x: 0, y: CURVED_BEND }] }) : [];
    }
    case "bend": {
      // How far to the side the line's one point sits. With more points there is no one number to give.
      const through = arrowThrough(clip);
      if (box || through.length !== 1) return null;
      const reach = LIMITS.arrowPointReach * 100;
      const n = number(-reach, reach);
      if (n === null) return null;
      return update({ points: [{ x: through[0].x, y: round(n / 100, 4) }], ...((clip.bend ?? 0) !== 0 && { bend: 0 }) });
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
    case "volume": {
      // Whole percents, from silent to VOLUME_MAX times as recorded.
      const percent = parseNumber(raw);
      if (percent === null || (clip.type !== "video" && clip.type !== "audio" && clip.type !== "nest")) return null;
      const volume = clamp(Math.round(percent), 0, VOLUME_MAX * 100) / 100;
      if (clip.type === "nest") return volume === clip.volume ? [] : update({ volume });
      if (playhead === undefined || saved.type === "image") return volume === clip.volume ? [] : update({ volume });
      // A keyframed volume is keyed at the playhead, as a keyframed position is.
      const frame = clipFrame(saved, playhead);
      return volume === volumeAt(saved, frame) ? [] : writeVolumeOps(saved as MediaClip, frame, volume);
    }
    case "fadeIn":
    case "fadeOut": {
      // Whole frames, and never longer than the clip.
      const seconds = parseNumber(raw);
      if (seconds === null || (clip.type !== "video" && clip.type !== "audio")) return null;
      const frames = clamp(Math.round(seconds * fps), 0, clip.duration);
      return frames === (clip[field] ?? 0) ? [] : update({ [field]: frames });
    }
    case "speed": {
      // Whole percents. The clip's length follows, up to the clip after it and the end of its media.
      const percent = parseNumber(raw);
      if (percent === null || !hasSpeed(clip)) return null;
      return speedOps(clip, Math.round(percent) / 100, ctx.room ?? Infinity, lengthFrames);
    }
    case "pan": {
      const percent = parseNumber(raw);
      if (percent === null || !hasSpeed(clip)) return null;
      const pan = clamp(Math.round(percent), -100, 100) / 100;
      return pan === (clip.pan ?? 0) ? [] : update({ pan });
    }
    case "soundLowCut": {
      if ((raw !== "on" && raw !== "off") || !hasSpeed(clip)) return null;
      return (raw === "on") === (clip.sound?.lowCut ?? false) ? [] : update({ sound: { lowCut: raw === "on" } });
    }
    case "soundGate":
    case "soundCompress":
    case "soundDenoise": {
      // Whole percents of full strength.
      const percent = parseNumber(raw);
      if (percent === null || !hasSpeed(clip)) return null;
      const part = SOUND_PART[field];
      const value = clamp(Math.round(percent), 0, 100) / 100;
      return value === (clip.sound?.[part] ?? 0) ? [] : update({ sound: { [part]: value } });
    }
    case "soundBass":
    case "soundMid":
    case "soundTreble": {
      // Tenths of a decibel, up to the most a band can be turned.
      const db = parseNumber(raw);
      if (db === null || !hasSpeed(clip)) return null;
      const part = SOUND_PART[field];
      const value = round(clamp(db, -TONE_DB, TONE_DB), 1);
      return value === (clip.sound?.[part] ?? 0) ? [] : update({ sound: { [part]: value } });
    }
    case "sourceIn": {
      // Whole frames, kept where the clip still fits its media, when the media's length is known.
      const seconds = parseNumber(raw);
      if (seconds === null || seconds < 0 || !hasSpeed(clip)) return null;
      const range = slipRange(clip, lengthFrames);
      const sourceIn = clamp(Math.round(seconds * fps), range.min, range.max);
      return sourceIn === clip.in ? [] : update({ in: sourceIn });
    }
    case "brightness":
    case "contrast":
    case "saturation":
    case "temperature":
    case "vignette":
    case "hue":
    case "blur":
    case "sharpen":
    case "grain":
    case "pixelate":
    case "split":
    case "glitch":
    case "vhs": {
      const n = parseNumber(raw);
      if (n === null || !isColorClip(clip)) return null;
      const range = ADJUST_RANGE[field];
      const value = round(clamp(n, range.min, range.max) / range.per, 4);
      if (playhead === undefined || !isColorClip(saved)) return value === adjustOf(clip.adjust)[field] ? [] : update({ adjust: { [field]: value } });
      // A keyframed one is keyed at the playhead, as a keyframed position is.
      const frame = clipFrame(saved, playhead);
      return value === adjustAt(saved, frame)[field] ? [] : writeAdjustOps(saved, frame, field, value);
    }
    case "liftLevel":
    case "gammaLevel":
    case "gainLevel": {
      const n = parseNumber(raw);
      if (n === null) return null;
      return wheelOps(clip, LEVEL_WHEEL[field], { level: round(clamp(n, -100, 100) / 100, 3) });
    }
    case "lutAmount": {
      const n = parseNumber(raw);
      if (n === null || !isColorClip(clip) || !clip.grade?.lut) return null;
      const lutAmount = round(clamp(n, 0, 100) / 100, 3);
      return lutAmount === (clip.grade.lutAmount ?? 1) ? [] : update({ grade: { lutAmount } });
    }
    case "mask": {
      if ((raw !== "on" && raw !== "off") || !isColorClip(clip)) return null;
      if ((raw === "on") === !!clip.mask) return [];
      return update({ mask: raw === "on" ? { ...MASK_START } : null });
    }
    case "maskShape": {
      if (!isColorClip(clip) || !clip.mask || (raw !== "rect" && raw !== "ellipse")) return null;
      // A mask is one value: it is sent whole.
      return raw === clip.mask.shape ? [] : update({ mask: { ...clip.mask, shape: raw } });
    }
    case "maskInvert": {
      if (!isColorClip(clip) || !clip.mask || (raw !== "on" && raw !== "off")) return null;
      return (raw === "on") === (clip.mask.invert ?? false) ? [] : update({ mask: { ...clip.mask, invert: raw === "on" } });
    }
    case "maskX":
    case "maskY":
    case "maskWidth":
    case "maskHeight":
    case "maskFeather": {
      const n = parseNumber(raw);
      if (n === null || !isColorClip(clip) || !clip.mask) return null;
      const part = MASK_PART[field];
      const range = MASK_RANGE[field];
      const value = round(clamp(n, range.min, range.max) / 100, 4);
      return value === clip.mask[part] ? [] : update({ mask: { ...clip.mask, [part]: value } });
    }
    case "lookStrength": {
      // The look's colours at this share of their own. It stops at 1%: at 0 nothing of the look is left to have a
      // strength, and the field would go away under the hand dragging it. None is what takes a look off.
      const n = parseNumber(raw);
      const match = isColorClip(clip) ? lookMatch(clip.adjust) : null;
      const look = match && LOOKS.find((l) => l.id === match.id);
      if (n === null || !isColorClip(clip) || !match || !look) return null;
      const strength = round(clamp(n, 1, 100) / 100, 3);
      return strength === match.strength ? [] : update({ adjust: lookPatch(look, strength) });
    }
    case "flipH":
    case "flipV": {
      if ((raw !== "on" && raw !== "off") || !isPicture(clip)) return null;
      return (raw === "on") === (clip.transform[field] ?? false) ? [] : update({ transform: { [field]: raw === "on" } });
    }
    case "rounding": {
      const n = parseNumber(raw);
      if (n === null || !isPicture(clip)) return null;
      const rounding = round(clamp(n, 0, 100) / 100, 3);
      return rounding === (clip.rounding ?? 0) ? [] : update({ rounding });
    }
    case "chroma": {
      if ((raw !== "on" && raw !== "off") || !isPicture(clip)) return null;
      if ((raw === "on") === !!clip.chroma) return [];
      return update({ chroma: raw === "on" ? { ...CHROMA_START } : null });
    }
    case "chromaColor": {
      const color = raw.trim().toLowerCase();
      if (!isPicture(clip) || !clip.chroma || !HEX_COLOR.test(color)) return null;
      return color === clip.chroma.color.toLowerCase() ? [] : update({ chroma: { ...clip.chroma, color } });
    }
    case "chromaTolerance":
    case "chromaSoftness": {
      const n = parseNumber(raw);
      if (n === null || !isPicture(clip) || !clip.chroma) return null;
      const key = field === "chromaTolerance" ? "tolerance" : "softness";
      const value = round(clamp(n, 0, 100) / 100, 3);
      // The key is one value: it is sent whole.
      return value === clip.chroma[key] ? [] : update({ chroma: { ...clip.chroma, [key]: value } });
    }
    case "blend": {
      const blend = BlendMode.safeParse(raw);
      if (!blend.success || clip.type === "audio" || clip.type === "placeholder" || clip.type === "adjustment") return null;
      return blend.data === (clip.blend ?? "normal") ? [] : update({ blend: blend.data });
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
      // update_clip replaces the crop whole, so all four sides go. A keyed side is keyed at the playhead instead.
      return value === crop[side] ? [] : place({ crop: { ...crop, [side]: value } });
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
      return textLookOps(clip, field, raw);
  }
}
