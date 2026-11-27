import { DEFAULT_DIP_COLOR, DEFAULT_DIRECTION, DEFAULT_HIGHLIGHT_COLOR } from "@/lib/render/effects";
import { LIMITS } from "@/lib/limits";
import {
  EMPHASIS_AMOUNT,
  EMPHASIS_SPEED,
  type Emphasis,
  type MediaClip,
  type OpInput,
  type TextAnimationIn,
  type TextAnimationOut,
  type TextClip,
  type Transition,
  type TransitionKind,
} from "@/lib/timeline";

export const DEFAULT_EFFECT_SECONDS = 0.5;

export const TRANSITION_KINDS: { value: TransitionKind; label: string; in: boolean; out: boolean }[] = [
  { value: "fade", label: "Fade", in: true, out: true },
  { value: "crossfade", label: "Crossfade", in: true, out: false },
  { value: "slide", label: "Slide", in: true, out: true },
  { value: "zoom", label: "Zoom", in: true, out: true },
  { value: "whip", label: "Whip", in: true, out: true },
  { value: "dip", label: "Dip to color", in: true, out: true },
];

export const DIRECTIONS: { value: NonNullable<Transition["direction"]>; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

export const ANIMATION_IN: { value: TextAnimationIn["preset"]; label: string }[] = [
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide_up", label: "Slide up" },
  { value: "slide_down", label: "Slide down" },
  { value: "slide_left", label: "Slide left" },
  { value: "slide_right", label: "Slide right" },
  { value: "typewriter", label: "Typewriter" },
  { value: "scale_punch", label: "Scale punch" },
];

export const ANIMATION_OUT: { value: TextAnimationOut["preset"]; label: string }[] = ANIMATION_IN.filter(
  (a): a is { value: TextAnimationOut["preset"]; label: string } => a.value !== "typewriter" && a.value !== "scale_punch",
);

// What the Emphasis menu offers. Highlight word is no longer one of them: it lights the words for equal shares of the
// clip, which doesn't follow speech. A clip that has it keeps it, and its own menu lists it (emphasisOptions).
export const EMPHASIS: { value: Emphasis["preset"]; label: string }[] = [
  { value: "shake", label: "Shake" },
  { value: "pulse", label: "Pulse" },
];

const HIGHLIGHT_WORD = { value: "highlight_word", label: "Highlight word" } as const;

// The menu for a clip with this emphasis: the presets offered, and highlight word too when it is the clip's own, so
// the menu shows what the clip has.
export function emphasisOptions(current: Emphasis["preset"] | undefined): { value: Emphasis["preset"]; label: string }[] {
  return current === "highlight_word" ? [...EMPHASIS, HIGHLIGHT_WORD] : EMPHASIS;
}

// A shake or a pulse, the emphases that move the text, can move further or less and faster or slower: amount and
// speed, shown in whole percents of the look it has always had.
export const EMPHASIS_FIELDS = [
  { key: "amount", label: "Amount", range: EMPHASIS_AMOUNT },
  { key: "speed", label: "Speed", range: EMPHASIS_SPEED },
] as const;
export type EmphasisField = (typeof EMPHASIS_FIELDS)[number]["key"];

export const movesText = (e: Emphasis | null | undefined): e is Emphasis => e?.preset === "shake" || e?.preset === "pulse";

export function emphasisPercent(e: Emphasis, key: EmphasisField): number {
  return Math.round((e[key] ?? 1) * 100);
}

// The emphasis with its amount or speed set from a percent, whole and kept in range. 100% is kept as no value, as
// projects from before these fields have it.
export function withEmphasisPercent(e: Emphasis, key: EmphasisField, percent: number): Emphasis {
  const { range } = EMPHASIS_FIELDS.find((f) => f.key === key)!;
  const factor = Math.min(range.max * 100, Math.max(range.min * 100, Math.round(percent))) / 100;
  const next = { ...e };
  delete next[key];
  if (factor !== 1) next[key] = factor;
  return next;
}

// A new effect starts half a second long, and never outside what a project accepts.
export function defaultEffectFrames(fps: number): number {
  return clampEffectFrames(Math.round(DEFAULT_EFFECT_SECONDS * fps));
}

export function clampEffectFrames(frames: number): number {
  return Math.min(LIMITS.effectFramesMax, Math.max(1, Math.round(frames)));
}

// The whole value of the chosen kind: its own extras, and the length it had if it had one.
export function pickTransition(prev: Transition | null | undefined, kind: TransitionKind, fps: number): Transition {
  const frames = prev?.frames ?? defaultEffectFrames(fps);
  if (kind === "slide" || kind === "whip") return { kind, frames, direction: prev?.direction ?? DEFAULT_DIRECTION };
  if (kind === "dip") return { kind, frames, color: prev?.color ?? DEFAULT_DIP_COLOR };
  return { kind, frames };
}

// A shake turned into a pulse, or back, keeps its amount and speed: both are shares of the preset's own look.
export function pickEmphasis(prev: Emphasis | null | undefined, preset: Emphasis["preset"]): Emphasis {
  if (preset === "highlight_word") return { preset, color: prev?.color ?? DEFAULT_HIGHLIGHT_COLOR };
  const next: Emphasis = { preset };
  if (movesText(prev)) {
    if (prev.amount !== undefined) next.amount = prev.amount;
    if (prev.speed !== undefined) next.speed = prev.speed;
  }
  return next;
}

// Key order does not matter, and an absent value is the same as null.
function canon(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
}

const same = (a: unknown, b: unknown) => canon(a) === canon(b);

function update(clipId: string, current: unknown, patch: Record<string, unknown>, key: string): OpInput[] {
  return same(current, patch[key]) ? [] : [{ op: "update_clip", clipId, patch } as OpInput];
}

// Each builder sends the complete new value, because the project replaces a transition or animation whole.
export function transitionOps(clip: Pick<MediaClip, "id" | "transitionIn" | "transitionOut">, side: "in" | "out", next: Transition | null): OpInput[] {
  const key = side === "in" ? "transitionIn" : "transitionOut";
  return update(clip.id, clip[key], { [key]: next }, key);
}

export function animationOps(clip: TextClip, side: "in" | "out", next: TextAnimationIn | TextAnimationOut | null): OpInput[] {
  const key = side === "in" ? "animationIn" : "animationOut";
  return update(clip.id, clip[key], { [key]: next }, key);
}

export function emphasisOps(clip: TextClip, next: Emphasis | null): OpInput[] {
  return update(clip.id, clip.emphasis, { emphasis: next }, "emphasis");
}
