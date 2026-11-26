import {
  CAPTION_LOOK_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  FORMAT_OPTIONS,
  LOOK_OPTIONS,
  MUSIC_OPTIONS,
  PACE_OPTIONS,
  TEXT_OPTIONS,
  TRANSITION_KIND_OPTIONS,
  TRANSITION_OPTIONS,
  optionFor,
  type StyleOption,
} from "./fields";
import { STYLE_MESSAGES, STYLE_WORDS } from "./messages";
import { isSetValue, type ShotFacts, type StyleProfile, type StyleReference } from "./types";

// What the Style page says about a reference and a style, in plain words, from what is saved. Pure, so the page and
// its tests read the same lines.

const FACTS = STYLE_WORDS.facts;

// How long a channel video's facts are kept before the server cuts them back: CHANNEL_FACTS_DAYS in service.ts, which
// the browser can't import. A test keeps the two alike.
export const CHANNEL_DAYS = 30;
const CHANNEL_MS = CHANNEL_DAYS * 24 * 60 * 60 * 1000;

const oneDecimal = (n: number) => String(Number(n.toFixed(1)));

// How long something runs, in short words: "38 s", "2 min 5 s", "1 h 12 min".
export function lengthWords(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// A shot's length, to a tenth of a second under 10 seconds: "1.6 s", "12 s".
function shotWords(seconds: number): string {
  return seconds < 10 ? `${oneDecimal(seconds)} s` : `${Math.round(seconds)} s`;
}

function shotsLine(shots: ShotFacts): string {
  return FACTS.shots(shots.count, shotWords(shots.medianSeconds));
}

// The one line of facts a reference's card shows under its title, or null when there is nothing to say yet (a video
// not looked at). A video: "38 s · 24 shots, about 1.6 s each · talks 170 words a minute". A link: its site and author
// ("YouTube · Paper Planes Club"), or that its details couldn't be read. A project: "Project · 42 s · 18 shots, about
// 2.1 s each · 3 transitions".
export function referenceFacts(reference: StyleReference): string | null {
  const facts = reference.analysis;
  if (reference.kind === "link") {
    const link = facts?.kind === "link" ? facts : null;
    if (link?.unreadable) return STYLE_MESSAGES.linkUnreadable;
    const provider = reference.provider ?? link?.provider;
    const parts: string[] = [];
    if (provider) parts.push(provider === "youtube" && link?.short ? FACTS.youtubeShort : FACTS.providers[provider]);
    const author = reference.author ?? link?.author;
    if (author) parts.push(author);
    if (link?.seconds) parts.push(lengthWords(link.seconds));
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (facts?.kind === "video") {
    const parts = [lengthWords(facts.seconds), shotsLine(facts.shots)];
    if (facts.speech) parts.push(facts.speech.words > 0 ? FACTS.talks(Math.round(facts.speech.perMinute)) : FACTS.noTalking);
    return parts.join(" · ");
  }
  if (facts?.kind === "project") {
    const transitions = Object.values(facts.transitions).reduce((a, b) => a + b, 0);
    const parts = [FACTS.project, lengthWords(facts.seconds), shotsLine(facts.shots), transitions > 0 ? FACTS.transitions(transitions) : FACTS.noTransitions];
    if (facts.captions) parts.push(FACTS.captions);
    return parts.join(" · ");
  }
  return null;
}

// Whether a video from the space's YouTube channel has had its facts cut back, or soon will: read more than
// CHANNEL_DAYS ago, or at a time that can't be told. Reading it from the channel again brings them back.
export function channelFactsStale(reference: StyleReference, now: Date): boolean {
  if (reference.provider !== "channel") return false;
  const fetched = reference.analysis?.kind === "link" ? Date.parse(reference.analysis.fetchedAt) : Number.NaN;
  return !(now.getTime() - fetched <= CHANNEL_MS);
}

// Where looking over a video has got to, as its card says it: "Looking at the shots… 30%", "Listening… 42%",
// "Saving…". Waiting and saving have no share to give; nor does a step that hasn't started.
export function progressWords(progress: { stage: keyof typeof STYLE_WORDS.analyzing; done: number }): string {
  const label = `${STYLE_WORDS.analyzing[progress.stage]}…`;
  const counted = progress.stage === "shots" || progress.stage === "listening";
  const share = Math.round(Math.min(1, Math.max(0, progress.done)) * 100);
  return counted && share > 0 ? `${label} ${share}%` : label;
}

// A choice as someone reading the style sees it: its name and what it means ("Quick: A new shot every 1.2 to 2.5
// seconds."), or the value itself when no list knows it.
function choiceWords<T extends string>(options: readonly StyleOption<T>[], value: T): string {
  const option = optionFor(options, value);
  return option ? `${option.label}: ${option.help}` : value;
}

const labelOf = <T extends string>(options: readonly StyleOption<T>[], value: T) => optionFor(options, value)?.label ?? value;

// A profile field's value in plain words, for someone who can only read the style, or null when it isn't set. The
// Always and Never lists are shown one thing a line, so they come back joined only as a fallback.
export function profileValueWords(key: keyof StyleProfile, profile: StyleProfile): string | null {
  if (!isSetValue(profile[key])) return null;
  const V = STYLE_WORDS.values;
  switch (key) {
    case "summary":
    case "hook":
    case "voice":
      return profile[key] ?? null;
    case "formats":
      return (profile.formats ?? []).map((id) => labelOf(FORMAT_OPTIONS, id)).join(", ");
    case "lengthSeconds": {
      const length = profile.lengthSeconds!;
      return length.min === length.max ? V.about(oneDecimal(length.min)) : V.range(oneDecimal(length.min), oneDecimal(length.max));
    }
    case "pace":
      return choiceWords(PACE_OPTIONS, profile.pace!);
    case "shotSeconds":
      return V.about(oneDecimal(profile.shotSeconds!));
    case "captions": {
      const captions = profile.captions!;
      if (!captions.on) return V.off;
      const parts: string[] = [V.on];
      if (captions.look) parts.push(labelOf(CAPTION_LOOK_OPTIONS, captions.look));
      if (captions.uppercase) parts.push(V.allCaps);
      if (captions.position) parts.push(labelOf(CAPTION_POSITION_OPTIONS, captions.position));
      return parts.join(" · ");
    }
    case "text":
      return choiceWords(TEXT_OPTIONS, profile.text!);
    case "music":
      return choiceWords(MUSIC_OPTIONS, profile.music!);
    case "transitions":
      return choiceWords(TRANSITION_OPTIONS, profile.transitions!);
    case "transitionKinds":
      return (profile.transitionKinds ?? []).map((kind) => labelOf(TRANSITION_KIND_OPTIONS, kind)).join(", ");
    case "look":
      return choiceWords(LOOK_OPTIONS, profile.look!);
    case "always":
    case "never":
      return (profile[key] ?? []).join("; ");
    default:
      return null;
  }
}
