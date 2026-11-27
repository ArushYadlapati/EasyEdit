import { captionsShow, isCaptioned } from "@/lib/captions/cues";
import { LIMITS } from "@/lib/limits";
import {
  CaptionPreset,
  DEFAULT_FPS,
  FormatId,
  LOOKS,
  RETIRED_LOOKS,
  STYLE_KEYS,
  TransitionKind,
  captionStyleOf,
  docDuration,
  expandNests,
  isColorClip,
  isMediaClip,
  keptLook,
  lookMatch,
  type Adjust,
  type Clip,
  type TextClip,
  type TimelineDoc,
  type Track,
} from "@/lib/timeline";
import { ANALYSIS_LIMITS, type ProjectAnalysis } from "./types";
import { shotFactsOf } from "./video-facts";

// What a style learns from one of the space's past projects: how it is cut, its words on screen, its captions,
// transitions, music, speed changes, colour looks and effects, counted from the project's timeline. Only what plays
// is counted: a nest's clips where the nest plays them (the halves of a split nest each hold all of its clips but play
// only their own part), nothing on a hidden track that has to be seen, nothing on a muted one that has to be heard.
// Pure. The doc may be read without its transcripts and colour tables (they are big and not needed here), and may be
// an old one that lacks the fields added since.

// What kind of file each asset is, by asset id: the only way to tell music (an audio file) from a video's own sound
// split off onto an audio track.
export type AssetKinds = Record<string, "video" | "image" | "audio">;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// The text sizes, as a share of the frame's height: small under 3.5%, medium under 6%, large from there.
const TEXT_SIZE_SHARES = { small: 0.035, medium: 0.06 } as const;
// The most fonts one project lists, most used first.
const PROJECT_FONTS = 6;
// The changes that count as effects: the stylised ones, blur and dark edges.
const EFFECT_KEYS = [...STYLE_KEYS, "blur", "vignette"] as const;
const SHOT_TYPES: ReadonlySet<string> = new Set(["video", "image", "nest"]);

function frameRate(fps: unknown): number {
  return typeof fps === "number" && Number.isInteger(fps) && fps >= 1 && fps <= 240 ? fps : DEFAULT_FPS;
}

// A clip as it plays, with the track it is on.
type Played = { clip: Clip; track: Track };

// Every clip of the project with nests laid out (expandNests), each with its track. The nests stay in the list too:
// their own transitions, looks and effects count.
function playedClips(expanded: TimelineDoc): Played[] {
  return expanded.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })));
}

// Whether a clip is seen or heard: a sound on a track that isn't muted, a picture or text on one that isn't hidden,
// and a video on a track that is either.
function plays({ clip, track }: Played): boolean {
  if (clip.type === "audio") return !track.muted;
  if (clip.type === "video") return !track.hidden || !track.muted;
  return !track.hidden;
}

function seen({ track }: Played): boolean {
  return !track.hidden;
}

function wordsIn(text: unknown): number {
  return typeof text === "string" ? text.split(/\s+/u).filter(Boolean).length : 0;
}

function tallyUp(counts: Record<string, number>, name: string): void {
  counts[name] = (counts[name] ?? 0) + 1;
}

// A number a field holds, or the fallback when an old or odd doc has none there.
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// The fonts used, most used first (the first used first among equals), at most PROJECT_FONTS.
function topFonts(texts: readonly TextClip[]): string[] {
  const uses = new Map<string, number>();
  for (const clip of texts) {
    const font = typeof clip.style?.fontFamily === "string" ? clip.style.fontFamily.trim() : "";
    if (font && font.length <= 100) uses.set(font, (uses.get(font) ?? 0) + 1);
  }
  return [...uses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PROJECT_FONTS)
    .map(([font]) => font);
}

function textFacts(texts: readonly TextClip[], minutes: number, height: number): ProjectAnalysis["text"] {
  const sizes = { small: 0, medium: 0, large: 0 };
  let words = 0;
  for (const clip of texts) {
    words += wordsIn(clip.text);
    const share = (numberOr(clip.style?.fontSize, 0) * numberOr(clip.transform?.scale, 1)) / height;
    if (share < TEXT_SIZE_SHARES.small) sizes.small++;
    else if (share < TEXT_SIZE_SHARES.medium) sizes.medium++;
    else sizes.large++;
  }
  return {
    clips: texts.length,
    perMinute: minutes > 0 ? clamp(round(texts.length / minutes, 1), 0, 3600) : 0,
    fonts: topFonts(texts),
    averageWords: texts.length > 0 ? clamp(round(words / texts.length, 1), 0, LIMITS.textClipChars) : 0,
    sizes,
  };
}

// The project's caption look, when it shows captions: a caption track that isn't hidden, and a clip of the project's
// own with captions on. As where the editor finds caption lines (docCues): a clip on any track counts, since the
// caption track decides what shows, but one inside a nest doesn't.
function captionFacts(doc: TimelineDoc): ProjectAnalysis["captions"] {
  const captioned = doc.tracks.some((track) => track.clips.some((clip) => isCaptioned(doc, clip)));
  if (!captionsShow(doc) || !captioned) return null;
  const style = captionStyleOf(doc);
  const look = CaptionPreset.safeParse(style.preset);
  return {
    look: look.success ? look.data : "karaoke",
    uppercase: style.uppercase === true,
    y: clamp(round(numberOr(style.y, 0.8), 3), 0, 1),
  };
}

type TransitionCounts = ProjectAnalysis["transitions"];

function noTransitions(): TransitionCounts {
  return Object.fromEntries(TransitionKind.options.map((kind) => [kind, 0])) as TransitionCounts;
}

// The kind of a clip's transition in or out, when it has one the editor knows.
function transitionKind(clip: Clip | undefined, key: "transitionIn" | "transitionOut"): TransitionKind | null {
  const transition = (clip as { [k in typeof key]?: { kind?: unknown } | null } | undefined)?.[key];
  const kind = TransitionKind.safeParse(transition?.kind);
  return kind.success ? kind.data : null;
}

// Every transition in and out, by kind, on these clips.
function transitionFacts(clips: readonly Clip[]): TransitionCounts {
  const counts = noTransitions();
  for (const clip of clips) {
    for (const key of ["transitionIn", "transitionOut"] as const) {
      const kind = transitionKind(clip, key);
      if (kind) counts[kind]++;
    }
  }
  return counts;
}

// The cuts between shots (in the order they play) that have a transition, by kind: one for each cut, the way in to the
// shot after it where that has one, else the way out of the shot before it. The first shot's way in and the last
// one's way out aren't between shots, so they don't count.
function cutTransitions(shots: readonly Clip[]): TransitionCounts {
  const counts = noTransitions();
  for (let i = 1; i < shots.length; i++) {
    const kind = transitionKind(shots[i], "transitionIn") ?? transitionKind(shots[i - 1], "transitionOut");
    if (kind) counts[kind]++;
  }
  return counts;
}

// Text animations by preset: "pop in" and "fade out" for the ways in and out, the preset alone for an emphasis.
// Highlight word isn't counted: agents copy what these facts count, and neither the editor nor the agents' guide
// offers it any more.
function textAnimationFacts(texts: readonly TextClip[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const clip of texts) {
    if (clip.animationIn?.preset) tallyUp(counts, `${clip.animationIn.preset} in`);
    if (clip.animationOut?.preset) tallyUp(counts, `${clip.animationOut.preset} out`);
    if (clip.emphasis?.preset && clip.emphasis.preset !== "highlight_word") tallyUp(counts, clip.emphasis.preset);
  }
  return counts;
}

// Music: audio clips of audio files on tracks that aren't muted, nested ones included, and how loud they are set on
// average (each clip's volume times its track's, which for a nest's clip includes the nest's).
function musicFacts(played: readonly Played[], assetKinds: AssetKinds): ProjectAnalysis["music"] {
  const volumes: number[] = [];
  for (const p of played) {
    const { clip, track } = p;
    if (clip.type !== "audio" || !plays(p) || assetKinds[clip.assetId] !== "audio") continue;
    volumes.push(clamp(numberOr(clip.volume, 1) * numberOr(track.volume, 1), 0, 4));
  }
  if (volumes.length === 0) return null;
  return { clips: volumes.length, averageVolume: clamp(round(volumes.reduce((a, b) => a + b, 0) / volumes.length, 2), 0, 4) };
}

// Every look a clip's colours may be: the editor's, then the ones it took out, which count as the kept look nearest
// each, so a project graded with one still teaches its look.
const EVERY_LOOK = [...LOOKS, ...RETIRED_LOOKS];

// The colour looks clips have, by look id (clips with no look, or colours that are no look's, aren't counted), and the
// effects any clip has on, in a fixed order. Dark edges count as an effect only where they aren't part of a look.
function colorFacts(clips: readonly Clip[]): { looks: Record<string, number>; effects: string[] } {
  const looks: Record<string, number> = {};
  const found = new Set<string>();
  for (const clip of clips) {
    if (!isColorClip(clip)) continue;
    const adjust: Adjust | undefined = clip.adjust;
    if (!adjust) continue;
    const look = lookMatch(adjust, EVERY_LOOK);
    if (look && look.id !== "none") tallyUp(looks, keptLook(look.id));
    for (const key of EFFECT_KEYS) {
      if (numberOr(adjust[key], 0) === 0) continue;
      if (key === "vignette" && look) continue;
      found.add(key);
    }
  }
  return { looks, effects: EFFECT_KEYS.filter((key) => found.has(key)) };
}

// What a style learns from a past project's timeline. assetKinds names the kind of each file it uses (any not named
// is not counted as music). Shots are the clips on its first video track that isn't hidden (a nest is one shot; empty
// slots and adjustment layers aren't shots), and shots.transitions counts the transitions at the cuts between them.
// Everything else counts the clips inside nests too, where the nests play them, and leaves out what a hidden or muted
// track keeps from being seen or heard: transitions counts every way in and out on every clip that is seen. Seconds
// are to 0.1.
export function projectFacts(doc: TimelineDoc, assetKinds: AssetKinds): ProjectAnalysis {
  const fps = frameRate(doc.fps);
  const seconds = clamp(round(docDuration(doc) / fps, 1), 0, ANALYSIS_LIMITS.projectSeconds);
  const minutes = seconds / 60;
  const height = Math.max(1, numberOr(doc.height, 1));
  const played = playedClips(expandNests(doc));
  const shown = played.filter(seen).map((p) => p.clip);
  const texts = shown.filter((clip): clip is TextClip => clip.type === "text");

  const main = doc.tracks.find((track) => track.kind === "video" && !track.hidden);
  const shots = (main?.clips ?? []).filter((clip) => SHOT_TYPES.has(clip.type)).sort((a, b) => a.start - b.start);
  const format = FormatId.safeParse(doc.format);
  const { looks, effects } = colorFacts(shown);

  return {
    kind: "project",
    seconds,
    format: format.success ? format.data : "custom",
    fps,
    shots: { ...shotFactsOf(shots.map((clip) => clip.duration / fps), seconds), transitions: cutTransitions(shots) },
    text: textFacts(texts, minutes, height),
    captions: captionFacts(doc),
    transitions: transitionFacts(shown),
    textAnimations: textAnimationFacts(texts),
    music: musicFacts(played, assetKinds),
    speedChanges: played.filter((p) => plays(p) && isMediaClip(p.clip) && numberOr(p.clip.speed, 1) !== 1).length,
    looks,
    effects,
  };
}
