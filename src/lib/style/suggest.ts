import { LIMITS } from "@/lib/limits";
import { CaptionPreset, LOOKS, PresetId, TransitionKind } from "@/lib/timeline";
import {
  CaptionPosition,
  STYLE_LENGTH_SECONDS,
  STYLE_PROFILE_KEYS,
  STYLE_SHOT_SECONDS,
  isSetValue,
  paceFor,
  type ReferenceAnalysis,
  type StyleLook,
  type StyleProfile,
  type TransitionAmount,
} from "./types";

// A style worked out from what EasyEdit learned from a space's videos, links and past projects, for "Fill in from my
// videos": the person (or an agent) still has the last word, so it only ever fills fields left empty. Pure.

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const sum = (list: readonly number[]) => list.reduce((a, b) => a + b, 0);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// The value a share q (0 to 1) of the way through a list sorted smallest first, between neighbours where it falls.
function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

// Of three lengths or fewer, those near enough the middle one to be the same kind of video: no more than 3 times it,
// and no less than a third of it. With two there's no telling which one is odd, so both stay. Sorted in, sorted out.
const FAR = 3;
function nearTheMiddle(sorted: readonly number[]): readonly number[] {
  if (sorted.length < 3) return sorted;
  const middle = quantile(sorted, 0.5);
  return sorted.filter((n) => n <= middle * FAR && n >= middle / FAR);
}

// The value given most often, the one earlier in order among equals; undefined when none of them is in order.
function mostCommon<T extends string>(values: readonly T[], order: readonly T[]): T | undefined {
  let best: T | undefined;
  let most = 0;
  for (const option of order) {
    const n = values.filter((value) => value === option).length;
    if (n > most) [best, most] = [option, n];
  }
  return best;
}

// The format a video of this shape was most likely made for: tall, 4:5, square or wide.
function formatOfShape(width: number, height: number): PresetId | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  if (ratio < 0.7) return "short_9x16";
  if (ratio < 0.9) return "feed_4x5";
  if (ratio <= 1.1) return "square_1x1";
  return "long_16x9";
}

// Where captions at this share of the frame's height sit.
function positionOf(y: number): CaptionPosition {
  if (y < 1 / 3) return "upper";
  if (y < 2 / 3) return "middle";
  return "lower";
}

// The amount of transitions that many of them for each shot stands for, as the Style page words them: straight cuts
// when under 1 shot in 20 has one, lots when most shots do (over half), a few in between.
function transitionAmount(perShot: number): TransitionAmount {
  if (perShot < 0.05) return "cuts";
  if (perShot <= 0.5) return "few";
  return "lots";
}

// How the hook says talking videos open.
const TALKING_HOOK = "Starts talking straight away";

// The hook for videos that start talking: that they do, and the first words of the first such video, in quotes and
// cut at a word (with "…") to fit the field.
function talkingHook(opening: string | undefined): string {
  const words = (opening ?? "").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return TALKING_HOOK;
  const whole = `${TALKING_HOOK}: "${words.join(" ")}"`;
  if (whole.length <= LIMITS.styleShortTextChars) return whole;
  const room = LIMITS.styleShortTextChars - `${TALKING_HOOK}: "…"`.length;
  let said = "";
  for (const word of words) {
    const next = said ? `${said} ${word}` : word;
    if (next.length > room) break;
    said = next;
  }
  return said ? `${TALKING_HOOK}: "${said}…"` : TALKING_HOOK;
}

// The style the references point to, with only the fields they say something about:
// - pace and typical shot from the middle of each video's and project's middle shot length;
// - typical length from the spread of the lengths of the space's own videos and projects, or of the links' when there
//   are none (a link is often someone else's video): the middle half once there are 4 or more, else from the shortest
//   to the longest, leaving out one more than 3 times the middle one or under a third of it; to 5 seconds;
// - where they post from the projects' formats, the videos' shapes and links to Shorts or other tall clips;
// - captions on, in the projects' most used look, when projects show captions, else on when most videos talk (someone
//   talking through over 40% of the video);
// - transitions from how many of the projects' shots have one, and transition kinds (the 3 most used), color look
//   (natural when none), on-screen text (from text clips a minute) and music from the projects (music is soft when
//   it's set at 35% or quieter on average; intense is left for people to pick);
// - how they open ("Starts talking straight away", with the first words of the first video that talks), when most
//   videos talk.
// Summary, voice and tone, and the Always and Never lists are left for people to write.
export function suggestStyle(analyses: readonly ReferenceAnalysis[]): StyleProfile {
  const videos = analyses.filter((a) => a.kind === "video");
  const links = analyses.filter((a) => a.kind === "link");
  const projects = analyses.filter((a) => a.kind === "project");
  const profile: StyleProfile = {};

  const shots = [...videos, ...projects]
    .filter((a) => a.shots.count > 0 && finite(a.shots.medianSeconds) && a.shots.medianSeconds > 0)
    .map((a) => a.shots.medianSeconds)
    .sort((a, b) => a - b);
  if (shots.length > 0) {
    const shot = clamp(round(quantile(shots, 0.5), 1), STYLE_SHOT_SECONDS.min, STYLE_SHOT_SECONDS.max);
    profile.pace = paceFor(shot);
    profile.shotSeconds = shot;
  }

  const lengthsOf = (list: readonly (number | undefined)[]) => list.filter((n): n is number => finite(n) && n > 0).sort((a, b) => a - b);
  const own = lengthsOf([...videos, ...projects].map((a) => a.seconds));
  const pool = own.length > 0 ? own : lengthsOf(links.map((l) => l.seconds));
  const lengths = pool.length >= 4 ? pool : nearTheMiddle(pool);
  if (lengths.length > 0) {
    const spread = lengths.length >= 4;
    const fit = (n: number) => clamp(n, STYLE_LENGTH_SECONDS.min, STYLE_LENGTH_SECONDS.max);
    const max = fit(Math.ceil((spread ? quantile(lengths, 0.75) : lengths[lengths.length - 1]) / 5) * 5);
    const min = Math.min(max, fit(Math.floor((spread ? quantile(lengths, 0.25) : lengths[0]) / 5) * 5));
    profile.lengthSeconds = { min, max };
  }

  const places: PresetId[] = [];
  for (const project of projects) {
    const format = PresetId.safeParse(project.format);
    if (format.success) places.push(format.data);
  }
  for (const video of videos) {
    const format = formatOfShape(video.width, video.height);
    if (format) places.push(format);
  }
  for (const link of links) if (link.short === true) places.push("short_9x16");
  if (places.length > 0) {
    const uses = (id: PresetId) => places.filter((place) => place === id).length;
    profile.formats = PresetId.options.filter((id) => uses(id) > 0).sort((a, b) => uses(b) - uses(a));
  }

  const talking = videos.flatMap((v) => (v.speech && v.speech.talkingShare > 0.4 ? [v.speech] : []));
  const mostlyTalk = videos.length > 0 && talking.length * 2 > videos.length;

  const captioned = projects.flatMap((p) => (p.captions ? [p.captions] : []));
  if (captioned.length > 0) {
    profile.captions = {
      on: true,
      look: mostCommon(captioned.map((c) => c.look), CaptionPreset.options),
      uppercase: captioned.filter((c) => c.uppercase).length * 2 > captioned.length,
      position: mostCommon(captioned.map((c) => positionOf(c.y)), CaptionPosition.options),
    };
  } else if (mostlyTalk) {
    profile.captions = { on: true };
  }

  if (projects.length > 0) {
    const counted = TransitionKind.options.map((kind) => [kind, sum(projects.map((p) => p.transitions[kind] ?? 0))] as const);
    const kinds = Object.fromEntries(counted) as Record<TransitionKind, number>;
    const shotCount = sum(projects.map((p) => p.shots.count));
    if (shotCount > 0) profile.transitions = transitionAmount(round(sum(Object.values(kinds)) / shotCount, 2));
    const used = TransitionKind.options.filter((kind) => kinds[kind] > 0).sort((a, b) => kinds[b] - kinds[a]);
    if (used.length > 0) profile.transitionKinds = used.slice(0, 3);
  }

  const minutes = sum(projects.map((p) => p.seconds)) / 60;
  if (projects.length > 0 && minutes > 0) {
    const textPerMinute = round(sum(projects.map((p) => p.text.clips)) / minutes, 2);
    profile.text = textPerMinute === 0 ? "none" : textPerMinute < 6 ? "light" : "lots";
  }

  if (projects.length > 0) {
    const looks = LOOKS.map((look) => ({ id: look.id, uses: sum(projects.map((p) => p.looks[look.id] ?? 0)) }));
    const best = looks.reduce((a, b) => (b.uses > a.uses ? b : a));
    profile.look = (best.uses > 0 ? best.id : "natural") as StyleLook;

    const music = projects.flatMap((p) => (p.music && p.music.clips > 0 ? [p.music] : []));
    if (music.length === 0) profile.music = "none";
    else {
      const volume = round(sum(music.map((m) => m.clips * m.averageVolume)) / sum(music.map((m) => m.clips)), 2);
      profile.music = volume <= 0.35 ? "soft" : "upbeat";
    }
  }

  if (mostlyTalk) profile.hook = talkingHook(talking[0].opening);
  return profile;
}

// What "Fill in from my videos" does: the current profile with each field it leaves empty filled from the
// suggestion, and which fields those were, in the Style page's order. Nothing the person set is changed. A suggested
// pace or typical shot that disagrees with the other one the person set is left out, so the two never contradict.
export function mergeSuggestion(
  current: StyleProfile,
  suggestion: StyleProfile,
): { profile: StyleProfile; filled: (keyof StyleProfile)[] } {
  const profile: Record<string, unknown> = { ...current };
  const filled: (keyof StyleProfile)[] = [];
  for (const key of STYLE_PROFILE_KEYS) {
    if (isSetValue(current[key]) || !isSetValue(suggestion[key])) continue;
    if (key === "shotSeconds" && current.pace && paceFor(suggestion.shotSeconds!) !== current.pace) continue;
    if (key === "pace" && current.shotSeconds !== undefined && paceFor(current.shotSeconds) !== suggestion.pace) continue;
    const value = suggestion[key];
    profile[key] = Array.isArray(value) ? [...value] : typeof value === "object" ? { ...value } : value;
    filled.push(key);
  }
  return { profile: profile as StyleProfile, filled };
}
