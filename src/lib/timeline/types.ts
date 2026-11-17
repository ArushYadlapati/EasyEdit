import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { UNSTORABLE_TEXT, isStorableText } from "@/lib/text";

export const TrackName = z.string().max(LIMITS.trackNameChars).refine(isStorableText, UNSTORABLE_TEXT);

// The five named sizes. A custom format keeps its own width and height in the doc.
export const PresetId = z.enum(["short_9x16", "feed_4x5", "square_1x1", "long_16x9", "long_4k"]);
export type PresetId = z.infer<typeof PresetId>;
export const FormatId = z.enum([...PresetId.options, "custom"]);
export type FormatId = z.infer<typeof FormatId>;
export type FrameSize = { width: number; height: number };

export const TrackKind = z.enum(["video", "overlay", "text", "caption", "audio"]);
export type TrackKind = z.infer<typeof TrackKind>;

const CropSide = z.number().min(0).max(1);
// The share cut from each side of a clip's full picture or text box, before scale, stretch and rotation.
export const Crop = z
  .strictObject({ left: CropSide, top: CropSide, right: CropSide, bottom: CropSide })
  .refine((c) => c.left + c.right < 1 && c.top + c.bottom < 1, "a crop must leave part of the picture");
export type Crop = z.infer<typeof Crop>;

export const Transform = z.object({
  x: z.number(), // clip centre, normalised 0..1 of canvas (0.5,0.5 = centre)
  y: z.number(),
  scale: z.number().positive(), // 1 = fitted per `fit`; with a stretch, the height's factor
  stretch: z.number().positive().optional(), // width over height, as a factor of the clip's own shape: 2 = twice as wide for its height; absent = 1
  rotation: z.number(), // degrees
  opacity: z.number().min(0).max(1),
  fit: z.enum(["cover", "contain"]),
  crop: Crop.optional(), // video, image and text; the kept part stays where it was. Audio accepts and ignores it.
});
export type Transform = z.infer<typeof Transform>;

// A name on a clip that marks it as a place a person or Claude fills later (a template's slot).
export const Slot = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  hint: z.string().max(LIMITS.slotHintChars).refine(isStorableText, UNSTORABLE_TEXT).optional(),
});
export type Slot = z.infer<typeof Slot>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb");

// How a value travels from one keyframe to the next. "hold" stays put until the next keyframe, then jumps.
export const Ease = z.enum(["linear", "ease_in", "ease_out", "ease_in_out", "hold"]);
export type Ease = z.infer<typeof Ease>;

export const KeyframeProp = z.enum(["x", "y", "scale", "rotation", "opacity"]);
export type KeyframeProp = z.infer<typeof KeyframeProp>;

// `at` counts frames from the clip's start. It may be negative or past the end: a keyframe outside the clip only
// shapes the curve, so trimming a clip never has to throw one away. `ease` is the travel to the next keyframe.
export const Keyframe = z.strictObject({ at: z.number().int(), value: z.number(), ease: Ease.optional() });
export type Keyframe = z.infer<typeof Keyframe>;

const KeyframeList = z
  .array(Keyframe)
  .max(LIMITS.keyframesPerProperty)
  .refine((list) => list.every((k, i) => i === 0 || k.at > list[i - 1].at), "keyframes must be in time order, one per frame");

// A property with no list, or an empty one, is not keyframed and uses the clip's transform value.
export const Keyframes = z
  .strictObject({
    x: KeyframeList.optional(),
    y: KeyframeList.optional(),
    scale: KeyframeList.optional(),
    rotation: KeyframeList.optional(),
    opacity: KeyframeList.optional(),
  })
  .superRefine((k, ctx) => {
    if (k.opacity?.some((f) => f.value < 0 || f.value > 1)) {
      ctx.addIssue({ code: "custom", path: ["opacity"], message: "opacity keyframes must be between 0 and 1" });
    }
    if (k.scale?.some((f) => f.value <= 0)) {
      ctx.addIssue({ code: "custom", path: ["scale"], message: "scale keyframes must be above 0" });
    }
  });
export type Keyframes = z.infer<typeof Keyframes>;

const EffectFrames = z.number().int().min(1).max(LIMITS.effectFramesMax);

export const TransitionKind = z.enum(["fade", "crossfade", "slide", "zoom", "whip", "dip"]);
export type TransitionKind = z.infer<typeof TransitionKind>;

// direction is used by slide and whip (default left), color by dip (default black).
export const Transition = z.strictObject({
  kind: TransitionKind,
  frames: EffectFrames,
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  color: HexColor.optional(),
});
export type Transition = z.infer<typeof Transition>;

// A crossfade blends with the clip before this one, so it only makes sense at a clip's start.
const TransitionOut = Transition.refine((t) => t.kind !== "crossfade", "crossfade is only an in-transition");

export const TextAnimationIn = z.strictObject({
  preset: z.enum(["fade", "pop", "slide_up", "slide_down", "slide_left", "slide_right", "typewriter", "scale_punch"]),
  frames: EffectFrames,
});
export type TextAnimationIn = z.infer<typeof TextAnimationIn>;

export const TextAnimationOut = z.strictObject({
  preset: z.enum(["fade", "pop", "slide_up", "slide_down", "slide_left", "slide_right"]),
  frames: EffectFrames,
});
export type TextAnimationOut = z.infer<typeof TextAnimationOut>;

// Runs for the whole clip; highlight_word lights the words in `color` (default #FFD400).
export const Emphasis = z.strictObject({
  preset: z.enum(["shake", "pulse", "highlight_word"]),
  color: HexColor.optional(),
});
export type Emphasis = z.infer<typeof Emphasis>;

const ClipBase = {
  id: z.string().min(1),
  start: z.number().int().min(0),
  duration: z.number().int().min(1),
  transform: Transform,
};

export const MediaClip = z.object({
  ...ClipBase,
  type: z.enum(["video", "image", "audio"]),
  assetId: z.string().min(1),
  in: z.number().int().min(0),
  speed: z.number().positive(),
  volume: z.number().min(0).max(2),
  slot: Slot.optional(),
  // Video and image only; Audio clips are checked where clips are added and changed.
  keyframes: Keyframes.optional(),
  transitionIn: Transition.nullable().optional(),
  transitionOut: TransitionOut.nullable().optional(),
});
export type MediaClip = z.infer<typeof MediaClip>;

export const TextStyle = z.object({
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  fontWeight: z.number().int(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]),
});
export type TextStyle = z.infer<typeof TextStyle>;

export const TextClip = z.object({
  ...ClipBase,
  type: z.literal("text"),
  text: z.string().max(LIMITS.textClipChars).refine(isStorableText, UNSTORABLE_TEXT),
  style: TextStyle,
  slot: Slot.optional(),
  keyframes: Keyframes.optional(),
  animationIn: TextAnimationIn.nullable().optional(),
  animationOut: TextAnimationOut.nullable().optional(),
  emphasis: Emphasis.nullable().optional(),
});
export type TextClip = z.infer<typeof TextClip>;

// An empty slot: it holds a place on a track, takes no media yet, and draws nothing. Always has its slot.
// A visual slot can carry the effects a video or image clip takes, so the clip that fills it keeps them;
// an audio slot takes none (checked where clips are added and changed, as for audio clips).
export const PlaceholderClip = z.object({
  ...ClipBase,
  type: z.literal("placeholder"),
  accepts: z.enum(["visual", "audio"]),
  slot: Slot,
  keyframes: Keyframes.optional(),
  transitionIn: Transition.nullable().optional(),
  transitionOut: TransitionOut.nullable().optional(),
});
export type PlaceholderClip = z.infer<typeof PlaceholderClip>;

export const Clip = z.discriminatedUnion("type", [MediaClip, TextClip, PlaceholderClip]);
export type Clip = z.infer<typeof Clip>;

export function isPlaceholder(clip: Clip): clip is PlaceholderClip {
  return clip.type === "placeholder";
}

export const Track = z.object({
  id: z.string().min(1),
  kind: TrackKind,
  name: TrackName,
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  clips: z.array(Clip),
});
export type Track = z.infer<typeof Track>;

// The safe area's size as a share of the frame. It is centred sideways and starts at its format's default top
// (SAFE_AREA_DEFAULTS), so its height can be at most what is left below that top.
const SafeAreaSide = z.number().min(0.05).max(1);
export const SafeArea = z.strictObject({ width: SafeAreaSide, height: SafeAreaSide });
export type SafeArea = z.infer<typeof SafeArea>;

// A line across the frame that clips snap to, kept with the project for everyone in it. axis "x" is a vertical line
// at that share of the width, "y" a horizontal one at that share of the height. It has no time: it shows throughout.
export const Guide = z.strictObject({ id: z.string().min(1), axis: z.enum(["x", "y"]), at: z.number().min(0).max(1) });
export type Guide = z.infer<typeof Guide>;

export const TimelineDoc = z.object({
  schemaVersion: z.literal(1),
  format: FormatId,
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number().int(),
  tracks: z.array(Track),
  // A size per format, set in Settings; a format with none uses its default. Older projects have no field.
  safeAreas: z.partialRecord(FormatId, SafeArea).optional(),
  // In the order they were added. Older projects, and a project whose last guide was removed, have no field.
  guides: z.array(Guide).optional(),
});
export type TimelineDoc = z.infer<typeof TimelineDoc>;
