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

export const TrackKind = z.enum(["video", "overlay", "text", "caption", "audio", "shape"]);
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
  // A video or image mirrored side to side or top to bottom, in place. Other clips accept and ignore them.
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
});
export type Transform = z.infer<typeof Transform>;

// A name on a clip that marks it as a place a person or Claude fills later (a template's slot).
export const Slot = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  hint: z.string().max(LIMITS.slotHintChars).refine(isStorableText, UNSTORABLE_TEXT).optional(),
});
export type Slot = z.infer<typeof Slot>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb");

// A video's or image's colour and focus changes (adjust.ts). Each is 0, or absent, when the picture is as recorded.
const AdjustShare = z.number().min(-1).max(1);
const AdjustAmount = z.number().min(0).max(1);
export const Adjust = z.strictObject({
  brightness: AdjustShare.optional(),
  contrast: AdjustShare.optional(),
  saturation: AdjustShare.optional(),
  temperature: AdjustShare.optional(), // below 0 cooler, above 0 warmer
  hue: z.number().min(-180).max(180).optional(), // degrees
  blur: z.number().min(0).max(200).optional(), // project pixels
  vignette: z.number().min(0).max(1).optional(),
  // Stylised effects, drawn on the graphics card (render/finish-gl.ts). Each is how much, 0 to 1, but pixelate, which
  // is the side of its blocks in project pixels.
  sharpen: AdjustAmount.optional(),
  grain: AdjustAmount.optional(),
  pixelate: z.number().min(0).max(200).optional(),
  split: AdjustAmount.optional(), // red and blue pulled apart
  glitch: AdjustAmount.optional(),
  vhs: AdjustAmount.optional(),
});
export type Adjust = z.infer<typeof Adjust>;

const Unit = z.number().min(0).max(1);
export const CurvePoint = z.strictObject({ x: Unit, y: Unit });
export type CurvePoint = z.infer<typeof CurvePoint>;
// A curve from what a channel is (x) to what it becomes (y), through its points from left to right. None, or absent,
// is the straight line, which changes nothing; one point alone says nothing, so there are two or more.
export const Curve = z
  .array(CurvePoint)
  .max(LIMITS.curvePoints)
  .refine((points) => points.length !== 1, "a curve has two points or more, or none")
  .refine((points) => points.every((p, i) => i === 0 || p.x > points[i - 1].x), "a curve's points go from left to right, one per place");
export type Curve = z.infer<typeof Curve>;

// One colour wheel: where its puck sits inside the circle (x right, y up; the colour it pushes towards) and its
// brightness slider, −1 to 1. All 0 changes nothing.
const WheelSide = z.number().min(-1).max(1);
export const Wheel = z
  .strictObject({ x: WheelSide, y: WheelSide, level: WheelSide })
  .refine((w) => Math.hypot(w.x, w.y) <= 1.0001, "a wheel's puck stays inside its circle");
export type Wheel = z.infer<typeof Wheel>;

// A video's or image's colour grade (color/grade.ts), worked in this order: the wheels for its shadows (lift), middle
// tones (gamma) and highlights (gain); the curves, one for all three channels and one for each; and a look-up table
// of the project's (TimelineDoc.luts) by id, mixed in by lutAmount (absent: all of it). A table the project no longer
// has changes nothing.
export const Grade = z.strictObject({
  lift: Wheel.optional(),
  gamma: Wheel.optional(),
  gain: Wheel.optional(),
  curve: Curve.optional(),
  curveR: Curve.optional(),
  curveG: Curve.optional(),
  curveB: Curve.optional(),
  lut: z.string().min(1).max(64).nullable().optional(),
  lutAmount: Unit.optional(),
});
export type Grade = z.infer<typeof Grade>;

// A colour look-up table kept with the project: `size` steps along each of red, green and blue, each colour three
// bytes, as base64 text (color/cube.ts). Read from a .cube file and sampled down to at most 17 steps a side.
// The fields alone, for the op that adds one (its id may be left out there); every use checks lutFits.
export const LutFields = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(LIMITS.lutNameChars).refine(isStorableText, UNSTORABLE_TEXT),
  size: z.number().int().min(2).max(LIMITS.lutSize),
  data: z.string().regex(/^[A-Za-z0-9+/]*$/, "a table is base64 text"),
});
// Three bytes a colour is four characters of base64, with nothing left over.
export const lutFits = (lut: { size: number; data: string }) => lut.data.length === lut.size ** 3 * 4;
export const LUT_FITS = "a table has size × size × size colours";
export const Lut = LutFields.refine(lutFits, LUT_FITS);
export type Lut = z.infer<typeof Lut>;

// A colour taken out of a video or image, as a green screen is: pixels within `tolerance` of it go see-through, and
// over the next `softness` they fade back in. Both are shares, 0 to 1.
export const Chroma = z.strictObject({ color: HexColor, tolerance: z.number().min(0).max(1), softness: z.number().min(0).max(1) });
export type Chroma = z.infer<typeof Chroma>;

// A mask: the part of a picture (or of what an adjustment layer changes) that shows. A box or an ellipse, placed and
// sized in shares of the picture as it is shown (x, y its centre: 0.5, 0.5 the middle; width and height 1 the whole),
// its edge softened by `feather` (a share of its shorter side). Inverted, it is the part that does not show.
export const Mask = z.strictObject({
  shape: z.enum(["rect", "ellipse"]),
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  width: z.number().min(0.01).max(3),
  height: z.number().min(0.01).max(3),
  feather: z.number().min(0).max(1),
  invert: z.boolean().optional(),
});
export type Mask = z.infer<typeof Mask>;

// A video's or audio clip's sound clean-up. Each is off, or 0, when absent: a rumble filter, a noise gate, a
// compressor and noise reduction by how much (0 to 1), and three tone bands in decibels.
const ToneDb = z.number().min(-12).max(12);
export const SoundFx = z.strictObject({
  lowCut: z.boolean().optional(),
  gate: z.number().min(0).max(1).optional(),
  bass: ToneDb.optional(),
  mid: ToneDb.optional(),
  treble: ToneDb.optional(),
  compress: z.number().min(0).max(1).optional(),
  denoise: z.number().min(0).max(1).optional(),
});
export type SoundFx = z.infer<typeof SoundFx>;

// How a clip mixes with what is drawn under it. Absent means "normal".
export const BlendMode = z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "soft-light", "hard-light", "difference"]);
export type BlendMode = z.infer<typeof BlendMode>;

// How a value travels from one keyframe to the next. "hold" stays put until the next keyframe, then jumps.
export const Ease = z.enum(["linear", "ease_in", "ease_out", "ease_in_out", "hold"]);
export type Ease = z.infer<typeof Ease>;

// The first five move and fade a clip's picture. volume is a video's or audio clip's loudness over time, and the rest
// are a video's or image's colour changes and stylised effects (the keys of Adjust), so a filter can fade in or
// change as the clip plays. Which kind of clip takes which is checked in the ops.
const ADJUST_PROPS = ["brightness", "contrast", "saturation", "temperature", "hue", "blur", "vignette", "sharpen", "grain", "pixelate", "split", "glitch", "vhs"] as const;
// The four sides of a clip's crop can be keyed too, each a share of the picture cut from that side.
const CROP_PROPS = ["cropLeft", "cropTop", "cropRight", "cropBottom"] as const;
export const KeyframeProp = z.enum(["x", "y", "scale", "rotation", "opacity", "volume", ...ADJUST_PROPS, ...CROP_PROPS]);
export type KeyframeProp = z.infer<typeof KeyframeProp>;

// `at` counts frames from the clip's start. It may be negative or past the end: a keyframe outside the clip only
// shapes the curve, so trimming a clip never has to throw one away. `ease` is the travel to the next keyframe.
// `curve` shapes the travel to the next keyframe by hand: the two handles of a cubic bezier from (0, 0) to (1, 1), as
// x1, y1, x2, y2 (what CSS calls cubic-bezier). Time runs along x, so each x stays between 0 and 1; a y past 0 or 1
// overshoots and comes back. It takes the place of `ease`, except a "hold", which still holds.
const BezierX = z.number().min(0).max(1);
const BezierY = z.number().min(-2).max(3);
export const KeyframeCurve = z.tuple([BezierX, BezierY, BezierX, BezierY]);
export type KeyframeCurve = z.infer<typeof KeyframeCurve>;
export const Keyframe = z.strictObject({ at: z.number().int(), value: z.number(), ease: Ease.optional(), curve: KeyframeCurve.optional() });
export type Keyframe = z.infer<typeof Keyframe>;

const KeyframeList = z
  .array(Keyframe)
  .max(LIMITS.keyframesPerProperty)
  .refine((list) => list.every((k, i) => i === 0 || k.at > list[i - 1].at), "keyframes must be in time order, one per frame");

// A property with no list, or an empty one, is not keyframed and uses the clip's own value.
export const Keyframes = z
  .strictObject({
    x: KeyframeList.optional(),
    y: KeyframeList.optional(),
    scale: KeyframeList.optional(),
    rotation: KeyframeList.optional(),
    opacity: KeyframeList.optional(),
    volume: KeyframeList.optional(),
    brightness: KeyframeList.optional(),
    contrast: KeyframeList.optional(),
    saturation: KeyframeList.optional(),
    temperature: KeyframeList.optional(),
    hue: KeyframeList.optional(),
    blur: KeyframeList.optional(),
    vignette: KeyframeList.optional(),
    sharpen: KeyframeList.optional(),
    grain: KeyframeList.optional(),
    pixelate: KeyframeList.optional(),
    split: KeyframeList.optional(),
    glitch: KeyframeList.optional(),
    vhs: KeyframeList.optional(),
    cropLeft: KeyframeList.optional(),
    cropTop: KeyframeList.optional(),
    cropRight: KeyframeList.optional(),
    cropBottom: KeyframeList.optional(),
  })
  .superRefine((k, ctx) => {
    if (k.volume?.some((f) => f.value < 0 || f.value > VOLUME_MAX)) {
      ctx.addIssue({ code: "custom", path: ["volume"], message: `volume keyframes must be between 0 and ${VOLUME_MAX}` });
    }
    if (k.opacity?.some((f) => f.value < 0 || f.value > 1)) {
      ctx.addIssue({ code: "custom", path: ["opacity"], message: "opacity keyframes must be between 0 and 1" });
    }
    if (k.scale?.some((f) => f.value <= 0)) {
      ctx.addIssue({ code: "custom", path: ["scale"], message: "scale keyframes must be above 0" });
    }
    // A crop side is a share of the picture. Two opposite sides may add up to all of it at some moment: the picture
    // drawn then keeps a sliver (keyframes.ts), so no keyframe has to know of the others.
    for (const key of CROP_PROPS) {
      if (k[key]?.some((f) => f.value < 0 || f.value > CROP_KEY_MAX)) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} keyframes must be between 0 and ${CROP_KEY_MAX}` });
      }
    }
    // A colour keyframe takes what the colour itself takes.
    for (const key of ADJUST_PROPS) {
      if (k[key]?.some((f) => !Adjust.shape[key].safeParse(f.value).success)) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} keyframes must be in ${key}'s own range` });
      }
    }
  });
export type Keyframes = z.infer<typeof Keyframes>;

// The most one side's keyframe may cut.
export const CROP_KEY_MAX = 0.95;

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

// How far and how fast a shake or pulse moves, as factors of its own look: 1, or absent, is the look it has always had.
export const EMPHASIS_AMOUNT = { min: 0.1, max: 3 };
export const EMPHASIS_SPEED = { min: 0.25, max: 4 };

// Runs for the whole clip. highlight_word lights the words in `color` (default #FFD400) and ignores amount and speed;
// the editor and the agents' guide no longer offer it, but projects that have it keep it and draw it as before.
export const Emphasis = z.strictObject({
  preset: z.enum(["shake", "pulse", "highlight_word"]),
  color: HexColor.optional(),
  amount: z.number().min(EMPHASIS_AMOUNT.min).max(EMPHASIS_AMOUNT.max).optional(),
  speed: z.number().min(EMPHASIS_SPEED.min).max(EMPHASIS_SPEED.max).optional(),
});
export type Emphasis = z.infer<typeof Emphasis>;

const ClipBase = {
  id: z.string().min(1),
  start: z.number().int().min(0),
  duration: z.number().int().min(1),
  transform: Transform,
  // Clips that share a group's name are linked: on the timeline they are selected, and so moved and deleted, together.
  // Null or absent: the clip is on its own.
  group: z.string().min(1).max(40).nullable().optional(),
};

// The loudest a clip can be set: four times as recorded, about +12 dB. 1 is as recorded.
export const VOLUME_MAX = 4;

// A video clip's steadying: how far each frame of its file is moved back to take the camera's shake out, and how much
// larger the picture is drawn so the moves never show its edges. from: the file's frame, counted at the project's
// frame rate, of the first move. data: two signed 16-bit numbers a frame (across, down; in 20,000ths of the picture's
// width and height), in base64. See media/steady.ts.
export const Steady = z.strictObject({
  from: z.number().int().min(0),
  zoom: z.number().min(1).max(1.25),
  data: z.string().max(Math.ceil((LIMITS.steadyFrames * 4) / 3) * 4 + 4),
});
export type Steady = z.infer<typeof Steady>;

export const MediaClip = z.object({
  ...ClipBase,
  // An audio clip may also name a video file, and then plays that file's sound alone.
  type: z.enum(["video", "image", "audio"]),
  assetId: z.string().min(1),
  in: z.number().int().min(0),
  // 1 is as recorded. A video may also run backward (below 0) or hold one frame (0): see speed.ts. Audio and image
  // clips stay above 0 (checked in the ops).
  speed: z.number(),
  volume: z.number().min(0).max(VOLUME_MAX),
  // Video and audio only (checked in the ops): the frames over which the clip's sound rises from silence at its start
  // and falls back to it at its end. Absent means 0. Together they never count for more than the clip is long.
  fadeIn: z.number().int().min(0).optional(),
  fadeOut: z.number().int().min(0).optional(),
  slot: Slot.optional(),
  // Video and image only; Audio clips are checked where clips are added and changed.
  keyframes: Keyframes.optional(),
  transitionIn: Transition.nullable().optional(),
  transitionOut: TransitionOut.nullable().optional(),
  // Video and audio only (checked in the ops): this clip's speech is captioned. Absent means off.
  captions: z.boolean().optional(),
  // Video and image only (checked in the ops).
  adjust: Adjust.optional(),
  grade: Grade.optional(),
  blend: BlendMode.optional(),
  // Video and audio only (checked in the ops): where its sound sits between the left side (−1) and the right (1).
  pan: z.number().min(-1).max(1).optional(),
  // Video and audio only (checked in the ops): its sound's clean-up.
  sound: SoundFx.optional(),
  chroma: Chroma.nullable().optional(), // null or absent: no colour is taken out
  mask: Mask.nullable().optional(), // video and image only (checked in the ops); null or absent: all of it shows
  rounding: z.number().min(0).max(1).optional(), // how round its corners are: 0 square, 1 as round as its short side allows
  steady: Steady.nullable().optional(), // video only (checked in the ops); null or absent: drawn as recorded
});
export type MediaClip = z.infer<typeof MediaClip>;

// The first five are always there. The rest are optional, and absent means the value in TEXT_STYLE_DEFAULTS
// (text-style.ts): slanted and underlined letters, the room between letters and between lines (as shares of the font
// size), an outline around the letters, a shadow under them and a box behind the lines.
export const TextStyle = z.object({
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  fontWeight: z.number().int(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  letterSpacing: z.number().min(-0.2).max(2).optional(),
  lineHeight: z.number().min(0.5).max(4).optional(),
  outlineColor: HexColor.nullable().optional(),
  outlineWidth: z.number().min(0).max(200).optional(), // project pixels
  shadowColor: HexColor.nullable().optional(),
  shadowBlur: z.number().min(0).max(400).optional(), // project pixels, like its offsets
  shadowX: z.number().min(-1000).max(1000).optional(),
  shadowY: z.number().min(-1000).max(1000).optional(),
  shadowOpacity: z.number().min(0).max(1).optional(),
  backgroundColor: HexColor.nullable().optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
  backgroundPadding: z.number().min(0).max(3).optional(), // × font size
  backgroundRadius: z.number().min(0).max(2).optional(), // × font size
});
export type TextStyle = z.infer<typeof TextStyle>;

// A stretch of a text clip's words with a look of its own: from the character at `from` up to, not including, the one
// at `to` (counted as a text field counts them), and what differs there from the clip's style. See spans.ts.
export const TextSpan = z.strictObject({
  from: z.number().int().min(0),
  to: z.number().int().min(1),
  color: HexColor.optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});
export type TextSpan = z.infer<typeof TextSpan>;

export const TextClip = z.object({
  ...ClipBase,
  type: z.literal("text"),
  text: z.string().max(LIMITS.textClipChars).refine(isStorableText, UNSTORABLE_TEXT),
  style: TextStyle,
  // In order, not overlapping, inside the text (checked in the ops). null or absent: one look throughout.
  spans: z.array(TextSpan).max(LIMITS.textSpansPerClip).nullable().optional(),
  slot: Slot.optional(),
  keyframes: Keyframes.optional(),
  animationIn: TextAnimationIn.nullable().optional(),
  animationOut: TextAnimationOut.nullable().optional(),
  emphasis: Emphasis.nullable().optional(),
  blend: BlendMode.optional(),
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

// A drawn shape: a box (rect), an ellipse, a many-sided shape (triangle, diamond, pentagon, hexagon, star), or an
// arrow. An arrow with no heads is a line. Its size is its own, in project pixels, so resizing never thickens its
// outline; scale (and its keyframes) scales the whole drawing. A many-sided shape fills its width by height box, its
// first corner at the top.
// An arrow lies along its own x-axis from tail (left) to tip (right), centred on the transform's x, y and turned by
// its rotation; `width` is its length and `height` is unused (0). Its line passes through each of its `points` on the
// way, in order, as a smooth curve; with none it is straight. A point is given in shares of the arrow's length from
// its middle: x along it (−0.5 the tail, 0.5 the tip), y sideways (positive towards its own +y). `bend` is the older
// way to say one point in the middle, {x: 0, y: bend}; it is read only while the arrow has no points.
export const ShapeKind = z.enum(["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star", "arrow"]);
export type ShapeKind = z.infer<typeof ShapeKind>;
export const ShapeDash = z.enum(["solid", "dashed", "dotted"]);
export type ShapeDash = z.infer<typeof ShapeDash>;
export const ArrowHeads = z.enum(["end", "start", "both", "none"]);
export type ArrowHeads = z.infer<typeof ArrowHeads>;
export const ArrowHead = z.enum(["triangle", "open", "bar"]);
export type ArrowHead = z.infer<typeof ArrowHead>;
const ShapeSide = z.number().min(0).max(LIMITS.shapeSideMax);
const ArrowReach = z.number().min(-LIMITS.arrowPointReach).max(LIMITS.arrowPointReach);
export const ArrowPoint = z.strictObject({ x: ArrowReach, y: ArrowReach });
export type ArrowPoint = z.infer<typeof ArrowPoint>;

// The fields alone, for schemas that extend them (op input, strict update); every use goes through shapeRules.
export const ShapeClipFields = z.object({
  ...ClipBase,
  type: z.literal("shape"),
  shape: ShapeKind,
  width: ShapeSide.refine((w) => w > 0, "a shape's width must be above 0"),
  height: ShapeSide,
  stroke: HexColor.nullable(), // the outline's (an arrow's line's) colour; null: none, for a filled box or ellipse
  strokeWidth: z.number().min(1).max(LIMITS.shapeStrokeMax),
  dash: ShapeDash,
  fill: HexColor.nullable().optional(), // every shape but an arrow; absent or null: see-through
  radius: z.number().min(0).max(LIMITS.shapeSideMax).optional(), // corner rounding in project pixels, for every shape with corners; drawn at most as far as the sides allow
  heads: ArrowHeads.optional(), // arrow: absent = "end"
  head: ArrowHead.optional(), // arrow: absent = "triangle"
  headSize: z.number().min(1).max(8).optional(), // arrow: the head's length as a multiple of strokeWidth; absent = 4
  bend: z.number().min(-0.5).max(0.5).optional(), // arrow: absent = 0, straight
  points: z.array(ArrowPoint).max(LIMITS.arrowPoints).optional(), // arrow: absent = none
  keyframes: Keyframes.optional(),
  transitionIn: TransitionOut.nullable().optional(), // no crossfade: a shape has nothing to blend from
  transitionOut: TransitionOut.nullable().optional(),
  blend: BlendMode.optional(),
});

export function shapeRules(c: Omit<z.infer<typeof ShapeClipFields>, "id">, ctx: z.RefinementCtx): void {
  if ((c.transform.stretch ?? 1) !== 1) {
    ctx.addIssue({ code: "custom", path: ["transform", "stretch"], message: "a shape takes no stretch: set its width and height" });
  }
  if (c.shape === "arrow") {
    if (c.stroke === null) ctx.addIssue({ code: "custom", path: ["stroke"], message: "an arrow needs a stroke colour" });
    if (c.fill != null) ctx.addIssue({ code: "custom", path: ["fill"], message: "an arrow has no fill" });
  } else {
    if (c.height <= 0) ctx.addIssue({ code: "custom", path: ["height"], message: "a shape's height must be above 0" });
    if (c.stroke === null && c.fill == null) ctx.addIssue({ code: "custom", path: ["stroke"], message: "a shape needs a stroke or a fill" });
    for (const key of ["heads", "head", "headSize", "bend", "points"] as const) {
      if (c[key] !== undefined) ctx.addIssue({ code: "custom", path: [key], message: `only an arrow takes ${key}` });
    }
  }
  if ((c.shape === "ellipse" || c.shape === "arrow") && c.radius !== undefined) {
    ctx.addIssue({ code: "custom", path: ["radius"], message: `${c.shape === "arrow" ? "an arrow" : "an ellipse"} takes no radius` });
  }
}

export const ShapeClip = ShapeClipFields.superRefine(shapeRules);
export type ShapeClip = z.infer<typeof ShapeClip>;

// An adjustment layer: a clip with no picture of its own. While it lasts it changes everything drawn under it (the
// tracks before its own) with the colour changes, stylised effects and grade a video takes. Its transform's opacity
// is how much of the change shows, so keyframes on opacity fade a filter in; its place, size and turn are unused.
export const AdjustmentClip = z.object({
  ...ClipBase,
  type: z.literal("adjustment"),
  adjust: Adjust.optional(),
  grade: Grade.optional(),
  mask: Mask.nullable().optional(), // the part of the frame it changes; null or absent: all of it
  keyframes: Keyframes.optional(), // opacity and the colours only (checked in the ops)
});
export type AdjustmentClip = z.infer<typeof AdjustmentClip>;

// A nest: several clips made into one. It holds a small timeline of its own (tracks of clips, starting at frame 0)
// and plays `duration` frames of it from frame `in`, at the speed it was made. On the frame it is one picture: its
// tracks are drawn together first, then placed, faded, graded and masked as a whole. Its sound is its clips' sound.
// A nest holds every kind of clip but an empty slot and another nest. Its clips' ids are its own: two nests (the
// halves of a split one, say) can hold clips of the same ids. See nest.ts.
const NestedClip = z.discriminatedUnion("type", [MediaClip, TextClip, ShapeClip, AdjustmentClip]);
export type NestedClip = z.infer<typeof NestedClip>;
export const NestTrack = z.object({
  id: z.string().min(1),
  kind: TrackKind.exclude(["caption"]),
  name: TrackName,
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  volume: z.number().min(0).max(VOLUME_MAX).optional(),
  clips: z.array(NestedClip),
});
export type NestTrack = z.infer<typeof NestTrack>;
export const NestClip = z.object({
  ...ClipBase,
  type: z.literal("nest"),
  name: z.string().max(LIMITS.nestNameChars).refine(isStorableText, UNSTORABLE_TEXT).nullable().optional(), // null or absent: named for what it holds
  in: z.number().int().min(0),
  volume: z.number().min(0).max(VOLUME_MAX), // on top of each of its clips' own
  tracks: z.array(NestTrack).min(1).max(LIMITS.tracksPerProject),
  keyframes: Keyframes.optional(), // its place, size, turn and opacity, and its colours (checked in the ops)
  transitionIn: Transition.nullable().optional(),
  transitionOut: TransitionOut.nullable().optional(),
  adjust: Adjust.optional(),
  grade: Grade.optional(),
  blend: BlendMode.optional(),
  mask: Mask.nullable().optional(),
});
export type NestClip = z.infer<typeof NestClip>;

// A caption clip: the captions of one media file, shown while it lasts. It lives on the Captions track only. Its lines
// are the words heard in the file's video and audio clips (captions/cues.ts), those that fall inside the clip; it
// draws them in the project's caption style and nothing else. It is linked (by group) to the clip it was made for, so
// the two move together; split it, trim it or delete a piece to change where captions show.
export const CaptionClip = z.object({
  ...ClipBase,
  type: z.literal("caption"),
  assetId: z.string().min(1),
  // None of these: named only so code that reads them from any clip may (they are always absent).
  keyframes: z.undefined().optional(),
  transitionIn: z.undefined().optional(),
  transitionOut: z.undefined().optional(),
  blend: z.undefined().optional(),
  slot: z.undefined().optional(),
});
export type CaptionClip = z.infer<typeof CaptionClip>;

export const Clip = z.discriminatedUnion("type", [MediaClip, TextClip, PlaceholderClip, ShapeClip, AdjustmentClip, NestClip, CaptionClip]);
export type Clip = z.infer<typeof Clip>;

export function isCaptionClip(clip: Clip): clip is CaptionClip {
  return clip.type === "caption";
}

export function isPlaceholder(clip: Clip): clip is PlaceholderClip {
  return clip.type === "placeholder";
}

// A clip that plays a file from the library: video, image or audio. Text, slots and shapes name no asset.
export function isMediaClip<C extends Pick<Clip, "type">>(clip: C): clip is Extract<C, { type: MediaClip["type"] }> {
  return clip.type === "video" || clip.type === "image" || clip.type === "audio";
}

// A clip's slot, if it has one. Shapes, adjustment layers and nests never do.
export function slotOf(clip: Clip): Slot | undefined {
  return clip.type === "shape" || clip.type === "adjustment" || clip.type === "nest" ? undefined : clip.slot;
}

// A clip that takes colour changes, stylised effects and a grade: a video, an image, an adjustment layer or a nest.
export type ColorClip = (MediaClip & { type: "video" | "image" }) | AdjustmentClip | NestClip;
export function isColorClip(clip: Clip | undefined): clip is ColorClip {
  return !!clip && (clip.type === "video" || clip.type === "image" || clip.type === "adjustment" || clip.type === "nest");
}

export const Track = z.object({
  id: z.string().min(1),
  kind: TrackKind,
  name: TrackName,
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  // How loud every clip on the track is, on top of each clip's own volume: 1, or absent, changes nothing.
  volume: z.number().min(0).max(VOLUME_MAX).optional(),
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

// A named point in time on the timeline, kept with the project for everyone in it: a place to come back to, and one
// the playhead and clips snap to. at: its frame. An empty name is a marker with no label.
export const Marker = z.strictObject({
  id: z.string().min(1),
  at: z.number().int().min(0),
  name: z.string().max(LIMITS.markerNameChars).refine(isStorableText, UNSTORABLE_TEXT),
});
export type Marker = z.infer<typeof Marker>;

// One spoken word: its text and when it starts and ends, in milliseconds of the media file it was heard in.
export const CaptionWord = z
  .strictObject({
    // One word: no whitespace inside it, so lines wrap and highlight word by word.
    t: z
      .string()
      .min(1)
      .max(LIMITS.captionWordChars)
      .refine(isStorableText, UNSTORABLE_TEXT)
      .refine((t) => !/\s/u.test(t), "a caption word cannot hold whitespace"),
    s: z.number().int().min(0),
    e: z.number().int().min(0),
  })
  .refine((w) => w.e >= w.s, "a word cannot end before it starts");
export type CaptionWord = z.infer<typeof CaptionWord>;

export const CaptionPreset = z.enum(["block", "karaoke", "word", "bar"]);
export type CaptionPreset = z.infer<typeof CaptionPreset>;

// How every caption in the project looks. y is the share of the frame's height where the lines sit.
export const CaptionStyle = z.strictObject({
  preset: CaptionPreset,
  fontFamily: z.string().min(1).max(100),
  fontWeight: z.number().int().min(100).max(900),
  fontSize: z.number().positive().max(2000),
  color: HexColor,
  highlight: HexColor,
  y: z.number().min(0).max(1),
  uppercase: z.boolean(),
});
export type CaptionStyle = z.infer<typeof CaptionStyle>;

export const CaptionWords = z
  .array(CaptionWord)
  .max(LIMITS.captionWordsPerFile)
  .refine((words) => words.every((w, i) => i === 0 || w.s >= words[i - 1].s), "caption words must be in time order");
export type CaptionWords = z.infer<typeof CaptionWords>;

// Words are kept per media file (by asset id), so every clip cut from a file shares them. Both parts are optional.
export const Captions = z.strictObject({
  style: CaptionStyle.optional(),
  transcripts: z.record(z.string().min(1), CaptionWords).optional(),
});
export type Captions = z.infer<typeof Captions>;

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
  // The caption style and the words heard in each media file. Absent until captions are first used.
  captions: Captions.optional(),
  // In the order they were added. Older projects, and a project whose last marker was removed, have no field.
  markers: z.array(Marker).optional(),
  // Colour look-up tables read from files, in the order they were added, for clips' grades to name. Older projects,
  // and a project whose last table was removed, have no field.
  luts: z.array(Lut).max(LIMITS.lutsPerProject).optional(),
});
export type TimelineDoc = z.infer<typeof TimelineDoc>;
