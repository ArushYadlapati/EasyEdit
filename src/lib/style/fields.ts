import { TRANSITION_KINDS } from "@/lib/editor/effect-fields";
import { DEFAULT_FPS, FORMAT_PRESETS, LOOKS, escapeQuoted, type CaptionPreset, type PresetId, type TransitionKind } from "@/lib/timeline";
import {
  PACE_BUCKETS,
  isSetValue,
  type CaptionPosition,
  type MusicKind,
  type Pace,
  type StyleLook,
  type StyleProfile,
  type TextAmount,
  type TransitionAmount,
} from "./types";

// A field's name on the Style page and the line under it saying what it's for.
export type StyleFieldWords = { label: string; help: string };

// One choice in a field: the value kept, its name, and a line saying what it means.
export type StyleOption<T extends string> = { value: T; label: string; help: string };

// The name and help line of every profile field, as the Style page shows them.
export const STYLE_FIELDS: Record<keyof StyleProfile, StyleFieldWords> = {
  summary: { label: "In a sentence or two", help: "What your videos feel like, in your own words." },
  formats: { label: "Where you post", help: "Pick every place your videos go." },
  lengthSeconds: { label: "Typical length", help: "How long your videos usually run, in seconds." },
  pace: { label: "Pace", help: "How often a new shot starts." },
  shotSeconds: { label: "Typical shot", help: "About how many seconds one shot lasts." },
  hook: { label: "How you open", help: "What happens in the first second or two, so people keep watching." },
  captions: { label: "Captions", help: "The words people say, shown on screen as they say them." },
  text: { label: "On-screen text", help: "Titles and words you add, apart from captions." },
  music: { label: "Music", help: "The kind of music under your videos." },
  transitions: { label: "Transitions", help: "How one shot moves to the next." },
  transitionKinds: { label: "Transitions you use", help: "The kinds you pick when you do use one." },
  look: { label: "Look", help: "The color look your videos usually have." },
  voice: { label: "Voice and tone", help: "How you come across. For example: friendly, with quick jokes." },
  always: { label: "Always", help: "Things every video should do." },
  never: { label: "Never", help: "Things your videos should stay away from." },
};

// The parts of the Captions field.
export const CAPTION_FIELDS: Record<"on" | "look" | "uppercase" | "position", StyleFieldWords> = {
  on: { label: "Show captions", help: "Turn this on if your videos show what's said." },
  look: { label: "Caption look", help: "How the words appear." },
  uppercase: { label: "All caps", help: "Every caption in capital letters." },
  position: { label: "Position", help: "Where the captions sit in the frame." },
};

// The style's notes, which sit below the profile fields.
export const STYLE_NOTES_FIELD: StyleFieldWords = {
  label: "Notes for AI agents",
  help: "Anything else agents should know before they edit for you.",
};

// The places a style can say videos are posted: every named size, none of them custom.
export const FORMAT_OPTIONS: readonly StyleOption<PresetId>[] = [
  { value: "short_9x16", label: "Shorts, Reels and TikTok", help: `${FORMAT_PRESETS.short_9x16.label}, full screen on a phone.` },
  { value: "feed_4x5", label: "Feed posts", help: `${FORMAT_PRESETS.feed_4x5.label}, a little taller than square.` },
  { value: "square_1x1", label: "Square posts", help: `${FORMAT_PRESETS.square_1x1.label}.` },
  { value: "long_16x9", label: "YouTube", help: `${FORMAT_PRESETS.long_16x9.label}, for watching on a wide screen.` },
  { value: "long_4k", label: "YouTube 4K", help: `${FORMAT_PRESETS.long_4k.label}, sharper on big screens.` },
];

function paceHelp(bucket: (typeof PACE_BUCKETS)[number]): string {
  if (bucket.max === null) return `Long shots, more than ${bucket.min} seconds each.`;
  if (bucket.min === 0) return `Fast cuts, a new shot in under ${bucket.max} seconds.`;
  return `A new shot every ${bucket.min} to ${bucket.max} seconds.`;
}

const PACE_LABELS: Record<Pace, string> = { calm: "Calm", steady: "Steady", quick: "Quick", rapid: "Rapid" };

// The paces, from long shots to fast cuts, each with the shot lengths it stands for.
export const PACE_OPTIONS: readonly StyleOption<Pace>[] = PACE_BUCKETS.map((bucket) => ({
  value: bucket.id,
  label: PACE_LABELS[bucket.id],
  help: paceHelp(bucket),
}));

// The caption looks, named as the editor's Captions controls name them.
export const CAPTION_LOOK_OPTIONS: readonly StyleOption<CaptionPreset>[] = [
  { value: "block", label: "Block", help: "A line or two of words at a time." },
  { value: "karaoke", label: "Karaoke", help: "Lines of words, with the one being said lit up." },
  { value: "word", label: "One word", help: "One word at a time, each popping in." },
  { value: "bar", label: "Bar", help: "A box behind the words, so they read on any picture." },
];

// Where captions can sit.
export const CAPTION_POSITION_OPTIONS: readonly StyleOption<CaptionPosition>[] = [
  { value: "upper", label: "Top", help: "Near the top of the frame." },
  { value: "middle", label: "Middle", help: "In the middle of the frame." },
  { value: "lower", label: "Bottom", help: "Near the bottom of the frame." },
];

// How much on-screen text there is.
export const TEXT_OPTIONS: readonly StyleOption<TextAmount>[] = [
  { value: "none", label: "None", help: "No words on screen apart from captions." },
  { value: "light", label: "A little", help: "A title or a few key words." },
  { value: "lots", label: "Lots", help: "Words on screen through most of the video." },
];

// The kinds of music.
export const MUSIC_OPTIONS: readonly StyleOption<MusicKind>[] = [
  { value: "none", label: "None", help: "No music, just the sound you recorded." },
  { value: "soft", label: "Soft", help: "Quiet music in the background." },
  { value: "upbeat", label: "Upbeat", help: "Bright music with energy." },
  { value: "intense", label: "Intense", help: "Loud, driving music that sets the pace." },
];

// How often there are transitions.
export const TRANSITION_OPTIONS: readonly StyleOption<TransitionAmount>[] = [
  { value: "cuts", label: "Straight cuts", help: "One shot goes straight to the next." },
  { value: "few", label: "A few", help: "Mostly cuts, with a transition now and then." },
  { value: "lots", label: "Lots", help: "A transition between most shots." },
];

const TRANSITION_HELP: Record<TransitionKind, string> = {
  fade: "Fades in from black or out to black.",
  crossfade: "Blends from the shot before.",
  slide: "Slides in or out of the frame.",
  zoom: "Zooms in or out.",
  whip: "A fast, blurred swipe.",
  dip: "Dips to a color, then back.",
};

// The kinds of transition, named as the editor's Effects tab names them.
export const TRANSITION_KIND_OPTIONS: readonly StyleOption<TransitionKind>[] = TRANSITION_KINDS.map((kind) => ({
  value: kind.value,
  label: kind.label,
  help: TRANSITION_HELP[kind.value],
}));

// What each of the editor's color looks does, by look id.
export const LOOK_HELP: Readonly<Record<string, string>> = {
  vivid: "Richer colors, with a bit more contrast.",
  warm: "A warmer, orange tint.",
  cool: "A cooler, blue tint.",
  dusk: "Cool evening colors with darker edges.",
  fade: "Washed-out, faded colors.",
  vintage: "Warm, muted colors with dark edges, like old film.",
  moody: "Darker, muted and cool.",
  drama: "Strong contrast with dark edges.",
  mono: "Black and white.",
  sepia: "Brown tones, like an old photo.",
};

// The looks a style can have: natural first, then the editor's color looks in their own order.
export const LOOK_OPTIONS: readonly StyleOption<StyleLook>[] = [
  { value: "natural", label: "Natural", help: "No color look, just the footage as it was shot." },
  ...LOOKS.map((look) => ({ value: look.id, label: look.label, help: LOOK_HELP[look.id] ?? look.label })),
];

// The option with this value in a list, if there is one.
export function optionFor<T extends string>(options: readonly StyleOption<T>[], value: T): StyleOption<T> | undefined {
  return options.find((option) => option.value === value);
}

// --- For agents ---

const num = (n: number) => String(Number(n.toFixed(2)));
const seconds = (n: number) => `${num(n)} ${num(n) === "1" ? "second" : "seconds"}`;
const quoted = (text: string) => `"${escapeQuoted(text)}"`;

// A help line as the end of a sentence: "Bright music with energy." → "bright music with energy".
function asClause(help: string): string {
  return help.charAt(0).toLowerCase() + help.slice(1).replace(/\.$/, "");
}

function described<T extends string>(options: readonly StyleOption<T>[], value: T): string {
  const option = optionFor(options, value);
  return option ? `${value} — ${asClause(option.help)}` : quoted(value);
}

function formatName(id: PresetId): string {
  const option = optionFor(FORMAT_OPTIONS, id);
  return option ? `${option.label} (${id})` : quoted(id);
}

function paceLine(pace: Pace | undefined, shotSeconds: number | undefined, fps: number): string {
  const frames = (s: number) => Math.max(1, Math.round(s * fps));
  const at = `at ${fps} fps`;
  const bucket = PACE_BUCKETS.find((b) => b.id === pace);
  let how: string | null = null;
  if (shotSeconds !== undefined) {
    const n = frames(shotSeconds);
    how = `a new shot about every ${seconds(shotSeconds)} (${n} ${n === 1 ? "frame" : "frames"} ${at})`;
  } else if (bucket) {
    if (bucket.max === null) how = `shots longer than ${bucket.min} seconds (more than ${frames(bucket.min)} frames ${at})`;
    else if (bucket.min === 0) how = `a new shot in under ${bucket.max} seconds (under ${frames(bucket.max)} frames ${at})`;
    else how = `a new shot every ${bucket.min} to ${bucket.max} seconds (${frames(bucket.min)} to ${frames(bucket.max)} frames ${at})`;
  }
  const name = pace === undefined ? null : bucket ? pace : quoted(pace);
  if (!how) return `Pace: ${name}.`;
  return name ? `Pace: ${name} — ${how}.` : `Pace: ${how}.`;
}

function captionLine(captions: NonNullable<StyleProfile["captions"]>): string {
  if (!captions.on) return "Captions: off.";
  const parts = ["on"];
  if (captions.look) {
    const look = optionFor(CAPTION_LOOK_OPTIONS, captions.look);
    parts.push(look ? `${look.label} look (preset ${look.value})` : `look ${quoted(captions.look)}`);
  }
  if (captions.uppercase !== undefined) parts.push(captions.uppercase ? "all caps" : "not all caps");
  if (captions.position) {
    const position = optionFor(CAPTION_POSITION_OPTIONS, captions.position);
    parts.push(position ? asClause(position.help) : `position ${quoted(captions.position)}`);
  }
  return `Captions: ${parts.join(", ")}.`;
}

// A space's style profile as plain lines for an agent, one per field that is set, in the Style page's order. Pace and
// typical shot share a line; shot lengths are also given in frames at the project's frame rate. Text people typed is
// quoted, and so is a value none of the lists know (one stored before a list changed), so it stays on its line.
export function describeProfile(profile: StyleProfile, fps: number = DEFAULT_FPS): string[] {
  const set = <K extends keyof StyleProfile>(key: K): StyleProfile[K] | undefined => (isSetValue(profile[key]) ? profile[key] : undefined);
  const lines: string[] = [];
  const summary = set("summary");
  if (summary) lines.push(`Summary: ${quoted(summary)}`);
  const formats = set("formats");
  if (formats) lines.push(`Where they post: ${formats.map(formatName).join("; ")}.`);
  const length = set("lengthSeconds");
  if (length) lines.push(length.min === length.max ? `Length: about ${seconds(length.min)}.` : `Length: ${num(length.min)} to ${num(length.max)} seconds.`);
  const pace = set("pace");
  const shotSeconds = set("shotSeconds");
  if (pace || shotSeconds !== undefined) lines.push(paceLine(pace, shotSeconds, fps));
  const hook = set("hook");
  if (hook) lines.push(`How they open: ${quoted(hook)}`);
  const captions = set("captions");
  if (captions) lines.push(captionLine(captions));
  const text = set("text");
  if (text) lines.push(`On-screen text: ${described(TEXT_OPTIONS, text)}.`);
  const music = set("music");
  if (music) lines.push(`Music: ${described(MUSIC_OPTIONS, music)}.`);
  const transitions = set("transitions");
  if (transitions) lines.push(`Transitions: ${described(TRANSITION_OPTIONS, transitions)}.`);
  const kinds = set("transitionKinds");
  if (kinds) lines.push(`Transition kinds they use: ${kinds.map((kind) => (optionFor(TRANSITION_KIND_OPTIONS, kind) ? kind : quoted(kind))).join(", ")}.`);
  const look = set("look");
  if (look) lines.push(`Color look: ${described(LOOK_OPTIONS, look)}.`);
  const voice = set("voice");
  if (voice) lines.push(`Voice and tone: ${quoted(voice)}`);
  const always = set("always");
  if (always) lines.push(`Always: ${always.map(quoted).join("; ")}`);
  const never = set("never");
  if (never) lines.push(`Never: ${never.map(quoted).join("; ")}`);
  return lines;
}
