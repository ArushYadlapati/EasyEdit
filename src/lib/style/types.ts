import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { UNSTORABLE_TEXT, isStorableText } from "@/lib/text";
import { CaptionPreset, FormatId, LOOKS, PresetId, TransitionKind, keptLook } from "@/lib/timeline";
import { STYLE_MESSAGES } from "./messages";

const count = (n: number) => n.toLocaleString("en-US");

// Words someone typed or a site gave: spaces trimmed off the ends, at most max characters, and storable.
function words(max: number) {
  return z.string().trim().max(max, `at most ${count(max)} characters`).refine(isStorableText, UNSTORABLE_TEXT);
}

function range(min: number, max: number) {
  const message = `a number from ${min} to ${max}`;
  return z.number().min(min, message).max(max, message);
}

function tally() {
  return z.number().int("a whole number").min(0, "0 or more").max(1_000_000, "at most 1,000,000");
}

function once<T>(list: readonly T[]): boolean {
  return new Set(list).size === list.length;
}

// --- The profile ---

// How often a new shot starts, from long shots to fast cuts.
export const Pace = z.enum(["calm", "steady", "quick", "rapid"]);
export type Pace = z.infer<typeof Pace>;

// Where the captions sit in the frame.
export const CaptionPosition = z.enum(["upper", "middle", "lower"]);
export type CaptionPosition = z.infer<typeof CaptionPosition>;

// How much on-screen text there is, apart from captions.
export const TextAmount = z.enum(["none", "light", "lots"]);
export type TextAmount = z.infer<typeof TextAmount>;

// The kind of music under the videos.
export const MusicKind = z.enum(["none", "soft", "upbeat", "intense"]);
export type MusicKind = z.infer<typeof MusicKind>;

// How often a shot moves to the next with a transition rather than a straight cut.
export const TransitionAmount = z.enum(["cuts", "few", "lots"]);
export type TransitionAmount = z.infer<typeof TransitionAmount>;

// The colour look of the videos: "natural" for none, else one of the editor's ready-made looks by id. A look the editor
// took out (a style saved before, or an agent going by older words) is read as the kept look nearest it, so "golden"
// is kept as "warm"; a refusal names only the kept ones.
export const StyleLook = z.preprocess((value) => (typeof value === "string" ? keptLook(value) : value), z.enum(["natural", ...LOOKS.map((look) => look.id)]));
export type StyleLook = z.infer<typeof StyleLook>;

// The longest and shortest a style's typical video length may be, in seconds.
export const STYLE_LENGTH_SECONDS = { min: 1, max: 3600 } as const;
// The shortest and longest a style's typical shot may be, in seconds.
export const STYLE_SHOT_SECONDS = { min: 0.2, max: 60 } as const;

const ListItem = words(LIMITS.styleListItemChars).min(1, "can't be blank");
const List = z.array(ListItem).max(LIMITS.styleListItems, `at most ${LIMITS.styleListItems} items`);

const PROFILE_SHAPE = {
  summary: words(LIMITS.styleSummaryChars),
  formats: z.array(PresetId).max(PresetId.options.length).refine(once, "each format once"),
  lengthSeconds: z
    .strictObject({
      min: range(STYLE_LENGTH_SECONDS.min, STYLE_LENGTH_SECONDS.max),
      max: range(STYLE_LENGTH_SECONDS.min, STYLE_LENGTH_SECONDS.max),
    })
    .refine((length) => length.min <= length.max, "min can't be more than max"),
  pace: Pace,
  shotSeconds: range(STYLE_SHOT_SECONDS.min, STYLE_SHOT_SECONDS.max),
  hook: words(LIMITS.styleShortTextChars),
  captions: z.strictObject({
    on: z.boolean(),
    look: CaptionPreset.optional(),
    uppercase: z.boolean().optional(),
    position: CaptionPosition.optional(),
  }),
  text: TextAmount,
  music: MusicKind,
  transitions: TransitionAmount,
  transitionKinds: z.array(TransitionKind).max(TransitionKind.options.length).refine(once, "each kind once"),
  look: StyleLook,
  voice: words(LIMITS.styleShortTextChars),
  always: List,
  never: List,
};

// How a space's videos look and feel, filled in by people or agents. Every field is optional; unknown keys are refused.
// An empty text or list means the same as a field left out.
export const StyleProfile = z.strictObject(PROFILE_SHAPE).partial();
export type StyleProfile = z.infer<typeof StyleProfile>;

// The fields a style profile has, in the order the Style page shows them.
export const STYLE_PROFILE_KEYS = Object.keys(PROFILE_SHAPE) as (keyof StyleProfile)[];

const PATCH_SHAPE = Object.fromEntries(Object.entries(PROFILE_SHAPE).map(([key, field]) => [key, field.nullable()])) as {
  [K in keyof typeof PROFILE_SHAPE]: z.ZodNullable<(typeof PROFILE_SHAPE)[K]>;
};

// A change to a profile: each field given replaces the one kept, and null clears it. Fields left out stay as they are.
export const StyleProfilePatch = z.strictObject(PATCH_SHAPE).partial();
export type StyleProfilePatch = z.infer<typeof StyleProfilePatch>;

// A style's notes for AI agents: anything the fields don't cover.
export const StyleNotes = z.string().trim().max(LIMITS.styleNotesChars, STYLE_MESSAGES.notesTooLong).refine(isStorableText, UNSTORABLE_TEXT);

// Whether a profile value says anything: given, and not an empty text or list.
export function isSetValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" || Array.isArray(value)) return value.length > 0;
  return true;
}

// The profile with a patch applied: each field given replaces the one kept; null, an empty text or an empty list
// takes the field off. The patch is assumed checked by StyleProfilePatch; keys that aren't profile fields are ignored.
export function applyStylePatch(profile: StyleProfile, patch: StyleProfilePatch): StyleProfile {
  const next: Record<string, unknown> = { ...profile };
  for (const key of STYLE_PROFILE_KEYS) {
    if (!Object.hasOwn(patch, key) || patch[key] === undefined) continue;
    if (isSetValue(patch[key])) next[key] = patch[key];
    else delete next[key];
  }
  return next as StyleProfile;
}

// A profile read back from the database: each field that still checks is kept and the rest are dropped, so one field
// that no longer fits (a choice no longer offered, a cap made smaller) doesn't lose the whole style. A look the editor
// took out still checks, as the kept look nearest it (see StyleLook). Not an object: {}.
export function storedProfile(value: unknown): StyleProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const stored = value as Record<string, unknown>;
  const profile: Record<string, unknown> = {};
  for (const key of STYLE_PROFILE_KEYS) {
    if (!Object.hasOwn(stored, key)) continue;
    const field = (PROFILE_SHAPE[key] as z.ZodType).safeParse(stored[key]);
    if (field.success && isSetValue(field.data)) profile[key] = field.data;
  }
  return profile as StyleProfile;
}

// --- Pace ---

// The typical shot length each pace stands for, in seconds: from `min` up to (and, for steady, including) `max`.
// Calm has no upper end.
export const PACE_BUCKETS: readonly { id: Pace; min: number; max: number | null }[] = [
  { id: "calm", min: 4, max: null },
  { id: "steady", min: 2.5, max: 4 },
  { id: "quick", min: 1.2, max: 2.5 },
  { id: "rapid", min: 0, max: 1.2 },
];

// The pace a typical shot of this many seconds has: rapid under 1.2 s, quick under 2.5 s, steady up to 4 s, calm over 4.
export function paceFor(shotSeconds: number): Pace {
  if (shotSeconds < 1.2) return "rapid";
  if (shotSeconds < 2.5) return "quick";
  if (shotSeconds <= 4) return "steady";
  return "calm";
}

// --- What EasyEdit learned from a reference ---

// The caps on what a reference's facts may hold.
export const ANALYSIS_LIMITS = {
  seconds: 4 * 60 * 60, // the longest reference video
  projectSeconds: 24 * 60 * 60, // the longest past project, and the longest shot in one
  side: 16_384, // a video's width or height, in pixels
  cuts: 400, // cut times kept for one video
  sheetFrames: 12, // frames in one video's strip
  sheetColumns: 12,
  openingWords: 30, // the first words said in a video
  openingChars: 300,
  descriptionChars: 500, // a link's description
  thumbnailChars: 2048, // a link's picture address
  tags: 15, // a link's tags
  tagChars: 100,
  fonts: 20, // fonts listed for one project
  names: 40, // looks, animations or effects counted for one project
  nameChars: 40,
} as const;

// A little room for rounding when a time is checked against a video's length, in seconds.
const END_SLACK = 0.05;

function twoPlaces(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

const Seconds = range(0, ANALYSIS_LIMITS.seconds);
const ProjectSeconds = range(0, ANALYSIS_LIMITS.projectSeconds);

// How a video or project is cut: how many shots, how long they run, and how many start a minute. A video's shots are
// also checked against its length.
export const ShotFacts = z.strictObject({
  count: tally(),
  averageSeconds: ProjectSeconds,
  medianSeconds: ProjectSeconds,
  firstSeconds: ProjectSeconds, // the first shot, which is often the hook
  perMinute: range(0, 3600),
});
export type ShotFacts = z.infer<typeof ShotFacts>;

// What is said in a video: how many words, how fast, the first words, and the share of the video with talking.
export const SpeechFacts = z.strictObject({
  words: z.number().int("a whole number").min(0).max(LIMITS.captionWordsPerFile),
  perMinute: range(0, 1000),
  opening: words(ANALYSIS_LIMITS.openingChars).refine(
    (text) => wordCount(text) <= ANALYSIS_LIMITS.openingWords,
    `at most ${ANALYSIS_LIMITS.openingWords} words`,
  ),
  talkingShare: range(0, 1),
});
export type SpeechFacts = z.infer<typeof SpeechFacts>;

// How loud a video is: its gated loudness and its peak, in decibels.
export const SoundFacts = z.strictObject({ loudnessDb: range(-120, 20), peakDb: range(-120, 20) });
export type SoundFacts = z.infer<typeof SoundFacts>;

// A video's colours on average: brightness and saturation from 0 to 1, warmth from -1 (blue) to 1 (orange).
export const ColorFacts = z.strictObject({ brightness: range(0, 1), saturation: range(0, 1), warmth: range(-1, 1) });
export type ColorFacts = z.infer<typeof ColorFacts>;

// The frames in a video's strip: the time of each, in order, and the grid they are laid out on.
export const SheetPlan = z
  .strictObject({
    times: z.array(Seconds).min(1).max(ANALYSIS_LIMITS.sheetFrames, `at most ${ANALYSIS_LIMITS.sheetFrames} frames`),
    columns: z.number().int().min(1).max(ANALYSIS_LIMITS.sheetColumns),
    rows: z.number().int().min(1).max(ANALYSIS_LIMITS.sheetFrames),
  })
  .refine((sheet) => sheet.times.every((t, i) => i === 0 || t >= sheet.times[i - 1]), { message: "in time order", path: ["times"] })
  .refine((sheet) => sheet.times.length <= sheet.columns * sheet.rows, "more frames than the grid holds")
  .refine((sheet) => (sheet.rows - 1) * sheet.columns < sheet.times.length, { message: "a row with no frames", path: ["rows"] });
export type SheetPlan = z.infer<typeof SheetPlan>;

const Side = z.number().int("a whole number").min(1).max(ANALYSIS_LIMITS.side);

// Why a video's words weren't heard, when they weren't: it wasn't asked to listen, the video has no sound to hear, it
// runs longer than Auto captions hears (with no words saved for it), or hearing it went wrong.
export const SpeechSkipped = z.enum(["off", "no-audio", "too-long", "failed"]);
export type SpeechSkipped = z.infer<typeof SpeechSkipped>;

// What a browser measured in one of the space's own videos. Browsers post it, so every number is checked: finite, in
// range, and times inside the video. Cut times are in seconds to two places, in order. speech is null both when the
// words were heard and fewer than three were found, and when they weren't heard at all; speechSkipped, given only with
// a null speech, says why they weren't (videos measured before it was kept don't have it).
export const VideoAnalysis = z
  .strictObject({
    kind: z.literal("video"),
    seconds: z.number().positive().max(ANALYSIS_LIMITS.seconds),
    width: Side,
    height: Side,
    shots: ShotFacts,
    cuts: z
      .array(Seconds.refine(twoPlaces, "seconds to two places"))
      .max(ANALYSIS_LIMITS.cuts, `at most ${ANALYSIS_LIMITS.cuts} cuts`),
    speech: SpeechFacts.nullable(),
    speechSkipped: SpeechSkipped.optional(),
    sound: SoundFacts.nullable(),
    color: ColorFacts,
    sheet: SheetPlan.nullable(),
    analyzedAt: z.iso.datetime(),
  })
  .superRefine((video, ctx) => {
    if (video.speechSkipped !== undefined && video.speech !== null) ctx.addIssue({ code: "custom", message: "only when no words were heard", path: ["speechSkipped"] });
    const end = video.seconds + END_SLACK;
    video.cuts.forEach((t, i) => {
      if (t > end) ctx.addIssue({ code: "custom", message: "after the video ends", path: ["cuts", i] });
      else if (i > 0 && t <= video.cuts[i - 1]) ctx.addIssue({ code: "custom", message: "in time order, each once", path: ["cuts", i] });
    });
    video.sheet?.times.forEach((t, i) => {
      if (t > end) ctx.addIssue({ code: "custom", message: "after the video ends", path: ["sheet", "times", i] });
    });
    for (const key of ["averageSeconds", "medianSeconds", "firstSeconds"] as const) {
      if (video.shots[key] > end) ctx.addIssue({ code: "custom", message: "longer than the video", path: ["shots", key] });
    }
  });
export type VideoAnalysis = z.infer<typeof VideoAnalysis>;

// Where a link reference came from: a video site, or the uploads of the space's connected YouTube channel.
export const LinkProvider = z.enum(["youtube", "vimeo", "tiktok", "channel"]);
export type LinkProvider = z.infer<typeof LinkProvider>;

// The image servers a link's picture may come from: YouTube's and Vimeo's, and TikTok's, which serves from many
// numbered hosts under these names.
const THUMBNAIL_HOSTS: ReadonlySet<string> = new Set(["i.ytimg.com", "i.vimeocdn.com"]);
const THUMBNAIL_HOST_ENDINGS = [".tiktokcdn.com", ".tiktokcdn-us.com", ".tiktokcdn-eu.com"] as const;

// A link's picture address as it may be kept and shown: https on YouTube's, Vimeo's or TikTok's image servers, on the
// usual port, with no name or password in it. null for anything else, which is dropped rather than shown.
export function thumbnailAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > ANALYSIS_LIMITS.thumbnailChars) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const known = THUMBNAIL_HOSTS.has(url.hostname) || THUMBNAIL_HOST_ENDINGS.some((ending) => url.hostname.endsWith(ending));
    return known && url.href.length <= ANALYSIS_LIMITS.thumbnailChars ? url.href : null;
  } catch {
    return null;
  }
}

// What a video site says about a public link. Only these few facts are kept; nothing is downloaded. Text longer than a
// cap must be cut to fit, and a picture not on thumbnailAddress's servers left out, before it is kept.
export const LinkAnalysis = z.strictObject({
  kind: z.literal("link"),
  provider: LinkProvider,
  title: words(LIMITS.styleShortTextChars).min(1, "can't be blank"),
  author: words(LIMITS.styleShortTextChars).optional(),
  thumbnailUrl: z
    .string()
    .max(ANALYSIS_LIMITS.thumbnailChars)
    .refine((url) => thumbnailAddress(url) !== null, "a picture from YouTube, Vimeo or TikTok")
    .optional(),
  seconds: z.number().positive().max(ANALYSIS_LIMITS.seconds).optional(),
  description: words(ANALYSIS_LIMITS.descriptionChars).optional(),
  tags: z.array(words(ANALYSIS_LIMITS.tagChars)).max(ANALYSIS_LIMITS.tags).optional(),
  short: z.boolean().optional(), // a Short or another vertical clip
  fetchedAt: z.iso.datetime(),
  unreadable: z.boolean().optional(), // true when the site gave none of its details, so the title is the link itself
});
export type LinkAnalysis = z.infer<typeof LinkAnalysis>;

const Name = z.string().min(1).max(ANALYSIS_LIMITS.nameChars);
const Counts = z
  .record(Name, tally())
  .refine((counts) => Object.keys(counts).length <= ANALYSIS_LIMITS.names, `at most ${ANALYSIS_LIMITS.names} names`);

// Looks counted by id. A project counted before the editor took a look out may have that look's id: it is read as the
// kept look nearest it, added to that one's count.
const LookCounts = Counts.transform((counts) => {
  const kept: Record<string, number> = {};
  for (const [id, n] of Object.entries(counts)) kept[keptLook(id)] = (kept[keptLook(id)] ?? 0) + n;
  return kept;
});

const TransitionCounts = z.record(TransitionKind, tally());

// What EasyEdit counted in one of the space's past projects. shots.transitions counts the cuts between its shots that
// have a transition, by kind (one for each cut); transitions counts every transition in and out on every clip that is
// seen. Projects counted before shots.transitions was added don't have it.
export const ProjectAnalysis = z.strictObject({
  kind: z.literal("project"),
  seconds: ProjectSeconds,
  format: FormatId,
  fps: z.number().int().min(1).max(240),
  shots: ShotFacts.extend({ transitions: TransitionCounts.optional() }),
  text: z.strictObject({
    clips: tally(),
    perMinute: range(0, 3600),
    fonts: z.array(z.string().min(1).max(100)).max(ANALYSIS_LIMITS.fonts),
    averageWords: range(0, LIMITS.textClipChars),
    sizes: z.strictObject({ small: tally(), medium: tally(), large: tally() }),
  }),
  captions: z.strictObject({ look: CaptionPreset, uppercase: z.boolean(), y: range(0, 1) }).nullable(),
  transitions: TransitionCounts,
  textAnimations: Counts,
  music: z.strictObject({ clips: tally(), averageVolume: range(0, 4) }).nullable(),
  speedChanges: tally(),
  looks: LookCounts,
  effects: z.array(Name).max(ANALYSIS_LIMITS.names),
});
export type ProjectAnalysis = z.infer<typeof ProjectAnalysis>;

// The facts kept for one reference, by its kind.
export const ReferenceAnalysis = z.discriminatedUnion("kind", [VideoAnalysis, LinkAnalysis, ProjectAnalysis]);
export type ReferenceAnalysis = z.infer<typeof ReferenceAnalysis>;

// --- References and the style ---

// What a style learns from: one of the space's videos, a public link, or one of its past projects.
export const ReferenceKind = z.enum(["video", "link", "project"]);
export type ReferenceKind = z.infer<typeof ReferenceKind>;

// A video waits as pending until a browser has looked at it; it is failed when that did not work.
export const ReferenceStatus = z.enum(["pending", "ready", "failed"]);
export type ReferenceStatus = z.infer<typeof ReferenceStatus>;

// One reference as members and agents see it. analysis is null until there is some (a pending or failed video);
// hasSheet says whether its strip of frames can be fetched; failure is why a failed one failed, in plain words.
export type StyleReference = {
  id: string;
  kind: ReferenceKind;
  title: string;
  status: ReferenceStatus;
  provider?: LinkProvider;
  author?: string;
  url?: string;
  thumbnailUrl?: string;
  assetId?: string;
  projectId?: string;
  analysis: ReferenceAnalysis | null;
  hasSheet: boolean;
  failure?: string;
  createdAt: string;
};

// A space's style: its profile and notes, and who changed it last (an actor id, a person's or an agent's) and when.
// updatedByName is that actor as the Style page names them ("Ada", or "Claude (for Ada)" for an agent), there once
// someone has changed the style.
export type Style = { profile: StyleProfile; notes: string; updatedAt: string | null; updatedBy: string | null; updatedByName?: string };

// The style of a space nobody has filled in.
export const DEFAULT_STYLE: Style = { profile: {}, notes: "", updatedAt: null, updatedBy: null };

// A change to a style: profile fields to replace or clear (see StyleProfilePatch), and new notes. Anything left out
// stays as it is.
export type StylePatch = { profile?: StyleProfilePatch; notes?: string };

// What a new reference is made from: one of the space's videos, a public link, or one of its past projects.
export type ReferenceSource = { kind: "video"; assetId: string } | { kind: "link"; url: string } | { kind: "project"; projectId: string };
