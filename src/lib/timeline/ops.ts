import { nanoid } from "nanoid";
import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { isStorableText } from "@/lib/text";
import { OpError } from "./errors";
import {
  Adjust,
  AdjustmentClip,
  BlendMode,
  CaptionStyle,
  CaptionWord,
  CaptionWords,
  Clip,
  FormatId,
  Grade,
  Guide,
  Keyframes,
  LUT_FITS,
  LutFields,
  Marker,
  MediaClip,
  PlaceholderClip,
  SafeArea,
  ShapeClipFields,
  Slot,
  SoundFx,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  TrackName,
  Transform,
  lutFits,
  shapeRules,
} from "./types";

const id = z.string().min(1);
const optionalId = { id: id.optional() };

const TrackPatch = z.object({
  name: TrackName.optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  volume: Track.shape.volume,
});

// The fields update_clip can change, each optional. transform, style and keyframes list only the sub-keys they
// compare; an empty keyframe list, or null for the others, means the clip has none.
const ClipExpect = z
  .object({
    assetId: MediaClip.shape.assetId,
    in: MediaClip.shape.in,
    speed: MediaClip.shape.speed,
    volume: MediaClip.shape.volume,
    text: TextClip.shape.text,
    slot: Slot.nullable(),
    group: MediaClip.shape.group,
    transform: Transform.partial().strict(),
    style: TextStyle.partial().strict(),
    keyframes: z.strictObject(Keyframes.shape),
    transitionIn: MediaClip.shape.transitionIn,
    transitionOut: MediaClip.shape.transitionOut,
    captions: MediaClip.shape.captions,
    fadeIn: MediaClip.shape.fadeIn,
    fadeOut: MediaClip.shape.fadeOut,
    pan: MediaClip.shape.pan,
    sound: SoundFx,
    adjust: Adjust,
    grade: Grade,
    blend: BlendMode,
    chroma: MediaClip.shape.chroma,
    mask: MediaClip.shape.mask,
    rounding: MediaClip.shape.rounding,
    animationIn: TextClip.shape.animationIn,
    animationOut: TextClip.shape.animationOut,
    emphasis: TextClip.shape.emphasis,
    spans: TextClip.shape.spans,
    shape: ShapeClipFields.shape.shape,
    width: ShapeClipFields.shape.width,
    height: ShapeClipFields.shape.height,
    stroke: ShapeClipFields.shape.stroke,
    strokeWidth: ShapeClipFields.shape.strokeWidth,
    dash: ShapeClipFields.shape.dash,
    fill: ShapeClipFields.shape.fill,
    radius: ShapeClipFields.shape.radius,
    heads: ShapeClipFields.shape.heads,
    head: ShapeClipFields.shape.head,
    headSize: ShapeClipFields.shape.headSize,
    bend: ShapeClipFields.shape.bend,
    points: ShapeClipFields.shape.points,
  })
  .partial()
  .strict();

const ClipInput = z.discriminatedUnion("type", [
  MediaClip.extend(optionalId),
  TextClip.extend(optionalId),
  PlaceholderClip.extend(optionalId),
  ShapeClipFields.extend(optionalId).superRefine(shapeRules),
  AdjustmentClip.extend(optionalId),
]);

const newTrack = { kind: TrackKind, name: TrackName };

const addTrackOp = <T extends z.ZodType>(trackId: T) =>
  z.object({
    op: z.literal("add_track"),
    track: z.object({ id: trackId, ...newTrack }),
    index: z.number().int().optional(),
  });
// With ripple, every clip at or after the new clip's start first moves right by its duration.
const addClipOp = <T extends z.ZodType>(clipSchema: T) =>
  z.object({ op: z.literal("add_clip"), trackId: id, clip: clipSchema, ripple: z.literal(true).optional() });
const splitClipOp = <T extends z.ZodType>(newClipId: T) =>
  z.object({ op: z.literal("split_clip"), clipId: id, at: z.number().int(), newClipId });
// index: where in the list the guide goes (an undone removal puts it back where it was); the end when left out.
// index: where in the list the marker goes (an undone removal puts it back where it was); the end when left out.
const addMarkerOp = <T extends z.ZodType>(markerId: T) =>
  z.object({ op: z.literal("add_marker"), marker: Marker.extend({ id: markerId }), index: z.number().int().optional() });
const addGuideOp = <T extends z.ZodType>(guideId: T) =>
  z.object({ op: z.literal("add_guide"), guide: Guide.extend({ id: guideId }), index: z.number().int().optional() });

// A colour look-up table joins the project. index: where in the list it goes (an undone removal puts it back where it
// was); the end when left out.
const addLutOp = <T extends z.ZodType>(lutId: T) =>
  z.object({ op: z.literal("add_lut"), lut: z.strictObject({ ...LutFields.shape, id: lutId }).refine(lutFits, LUT_FITS), index: z.number().int().optional() });

// Ops with no optional ids: one definition, shared by Op and OpInput.
const sharedOps = [
  // expect: the track's clip ids, in any order.
  z.object({ op: z.literal("remove_track"), trackId: id, expect: z.object({ clipIds: z.array(id) }).strict().optional() }),
  z.object({ op: z.literal("update_track"), trackId: id, patch: TrackPatch, expect: TrackPatch.strict().optional() }),
  // The track ends at index (clamped to the last place). expect: the index it must be at now.
  z.object({
    op: z.literal("move_track"),
    trackId: id,
    index: z.number().int().min(0),
    expect: z.object({ index: z.number().int() }).strict().optional(),
  }),
  z.object({
    op: z.literal("replace_track"),
    track: Track,
    index: z.number().int().min(0),
    restore: z.literal(true).optional(),
  }),
  z.object({
    op: z.literal("remove_clip"),
    clipId: id,
    ripple: z.boolean().optional(),
    expect: z.object({ start: z.number().int(), duration: z.number().int() }).strict().optional(),
  }),
  z.object({
    op: z.literal("move_clip"),
    clipId: id,
    start: z.number().int().min(0),
    trackId: id.optional(),
    expect: z.object({ start: z.number().int(), trackId: id.optional() }).strict().optional(),
  }),
  z.object({
    op: z.literal("trim_clip"),
    clipId: id,
    edge: z.enum(["start", "end"]),
    to: z.number().int(),
    in: z.number().int().min(0).optional(),
    expect: z
      .object({ start: z.number().int(), duration: z.number().int().optional(), in: z.number().int().optional() })
      .strict()
      .optional(),
  }),
  z.object({
    op: z.literal("update_clip"),
    clipId: id,
    patch: z.record(z.string(), z.unknown()),
    expect: ClipExpect.optional(),
  }),
  z.object({
    op: z.literal("set_format"),
    format: FormatId,
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    expect: z
      .object({ format: FormatId, width: z.number().int().optional(), height: z.number().int().optional() })
      .strict()
      .optional(),
  }),
  // One format's safe area size; null goes back to the default. expect: the size it must have now (null: the default).
  z.object({
    op: z.literal("set_safe_area"),
    format: FormatId,
    size: SafeArea.nullable(),
    expect: z.object({ size: SafeArea.nullable() }).strict().optional(),
  }),
  // A guide's new position; expect: the position it must have now.
  z.object({ op: z.literal("move_guide"), guideId: id, at: Guide.shape.at, expect: z.object({ at: Guide.shape.at }).strict().optional() }),
  // expect: the guide as it must be now.
  z.object({ op: z.literal("remove_guide"), guideId: id, expect: z.object({ guide: Guide }).strict().optional() }),
  // A marker's new frame, name or both; expect: what those must be now.
  z.object({
    op: z.literal("update_marker"),
    markerId: id,
    patch: Marker.omit({ id: true }).partial().strict(),
    expect: Marker.omit({ id: true }).partial().strict().optional(),
  }),
  // expect: the marker as it must be now.
  z.object({ op: z.literal("remove_marker"), markerId: id, expect: z.object({ marker: Marker }).strict().optional() }),
  // A table leaves the project. Clips that name it keep the name, and are drawn without it until it is back (an undo).
  // expect: the name it must have now.
  z.object({ op: z.literal("remove_lut"), lutId: id, expect: z.object({ name: LutFields.shape.name }).strict().optional() }),
  // Some of the caption style's keys, or clear: true to drop the stored style (back to the default); exactly one of the two.
  // expect: the values those keys must have now.
  z
    .object({
      op: z.literal("set_caption_style"),
      patch: CaptionStyle.partial().strict().optional(),
      clear: z.literal(true).optional(),
      expect: CaptionStyle.partial().strict().optional(),
    })
    .refine((o) => (o.patch === undefined) !== (o.clear === undefined), "give either patch or clear, not both and not neither"),
  // All the words of one media file; null removes them. expect: how many words the file has now (null: none).
  z.object({
    op: z.literal("set_transcript"),
    assetId: id,
    words: CaptionWords.nullable(),
    expect: z.object({ words: z.number().int().nullable() }).strict().optional(),
  }),
  // Replaces `remove` words from `index` with `insert`, or with `text`: the removed run said again in these words, with
  // times worked out from the run's own (at least one word must be removed). Exactly one of the two.
  // expect: the words being removed, as they must be now.
  z
    .object({
      op: z.literal("splice_caption_words"),
      assetId: id,
      index: z.number().int().min(0),
      remove: z.number().int().min(0),
      insert: z.array(CaptionWord).max(LIMITS.captionWordsPerFile).optional(),
      text: z.string().max(LIMITS.textClipChars).refine(isStorableText).optional(),
      expect: z.object({ words: z.array(CaptionWord) }).strict().optional(),
    })
    .refine((o) => (o.insert === undefined) !== (o.text === undefined), "give either insert or text, not both and not neither"),
] as const;

export const Op = z.discriminatedUnion("op", [
  addTrackOp(id),
  addClipOp(Clip),
  splitClipOp(id),
  addGuideOp(id),
  addMarkerOp(id),
  addLutOp(LutFields.shape.id),
  ...sharedOps,
]);
export type Op = z.infer<typeof Op>;

export const OpInput = z.discriminatedUnion("op", [
  addTrackOp(id.optional()),
  addClipOp(ClipInput),
  splitClipOp(id.optional()),
  addGuideOp(id.optional()),
  addMarkerOp(id.optional()),
  addLutOp(LutFields.shape.id.optional()),
  ...sharedOps,
]);
export type OpInput = z.infer<typeof OpInput>;

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}

function opLabel(raw: unknown, opIndex: number): string {
  const name = typeof raw === "object" && raw !== null ? (raw as { op?: unknown }).op : undefined;
  return typeof name === "string" ? `${name} (op ${opIndex})` : `Op ${opIndex}`;
}

export function prepareOps(ops: OpInput[], genId: () => string = () => nanoid(10)): Op[] {
  return ops.map((raw, opIndex) => {
    const parsed = OpInput.safeParse(raw);
    if (!parsed.success) {
      throw new OpError(
        "INVALID",
        `${opLabel(raw, opIndex)} is invalid: ${describeIssue(parsed.error)}`,
        opIndex,
      );
    }
    const input = parsed.data;
    let filled: unknown = input;
    if (input.op === "add_track") {
      filled = { ...input, track: { ...input.track, id: input.track.id ?? genId() } };
    } else if (input.op === "add_clip") {
      filled = { ...input, clip: { ...input.clip, id: input.clip.id ?? genId() } };
    } else if (input.op === "split_clip") {
      filled = { ...input, newClipId: input.newClipId ?? genId() };
    } else if (input.op === "add_guide") {
      filled = { ...input, guide: { ...input.guide, id: input.guide.id ?? genId() } };
    } else if (input.op === "add_marker") {
      filled = { ...input, marker: { ...input.marker, id: input.marker.id ?? genId() } };
    } else if (input.op === "add_lut") {
      filled = { ...input, lut: { ...input.lut, id: input.lut.id ?? genId() } };
    }
    const checked = Op.safeParse(filled);
    if (!checked.success) {
      throw new OpError(
        "INVALID",
        `${opLabel(raw, opIndex)} is invalid: ${describeIssue(checked.error)}`,
        opIndex,
      );
    }
    return checked.data;
  });
}
