import { graphemes } from "@/lib/text";
import { ease, effectiveTransform } from "@/lib/timeline/keyframes";
import type { Clip, MediaClip, TextClip, Transform } from "@/lib/timeline/types";

export const DEFAULT_DIRECTION = "left" as const;
export const DEFAULT_DIP_COLOR = "#000000";
export const DEFAULT_HIGHLIGHT_COLOR = "#FFD400";

// Whip trails: how far apart the copies sit (as a share of the frame) and how strong each one is.
const GHOST_ALPHAS = [0.45, 0.25, 0.12];
const GHOST_SPACING = 0.06;

type Dir = "left" | "right" | "up" | "down";

export type Ghost = { dx: number; dy: number; alpha: number }; // project pixels, alpha multiplier
export type Look = {
  transform: Transform; // keyframes applied, then in/out offsets and scale factors
  alpha: number; // multiplier on transform.opacity, 0..1
  ghosts: Ghost[]; // whip trails, drawn before the clip
  dip: { color: string; alpha: number } | null; // full-frame fill drawn after the clip
  reveal: number | null; // typewriter: graphemes to draw, null = all
  litWord: number | null; // highlight_word: index of the lit word among the text's words, null = none
  litColor: string | null;
};

type Doc = { width: number; height: number; fps: number };

const VECTORS: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

function declared(clip: Clip): { inFrames: number; outFrames: number } {
  if (clip.type === "audio") return { inFrames: 0, outFrames: 0 };
  if (clip.type === "text") {
    return { inFrames: clip.animationIn?.frames ?? 0, outFrames: clip.animationOut?.frames ?? 0 };
  }
  return { inFrames: clip.transitionIn?.frames ?? 0, outFrames: clip.transitionOut?.frames ?? 0 };
}

// When the two effects together outrun the clip, one that fits in half the clip keeps its length and the other gets
// the rest; when neither fits, each gets half. A lone effect can fill the whole clip. This happens at draw time only,
// so trimming a clip never has to rewrite its effects.
export function effectWindows(clip: Clip): { inFrames: number; outFrames: number } {
  const { inFrames, outFrames } = declared(clip);
  const d = clip.duration;
  if (inFrames + outFrames <= d) return { inFrames, outFrames };
  const half = Math.floor(d / 2);
  if (inFrames <= half) return { inFrames, outFrames: d - inFrames };
  if (outFrames <= half) return { inFrames: d - outFrames, outFrames };
  return { inFrames: half, outFrames: half };
}

// The first frame of an effect is already partly in and the last is fully in, so p never sits at 0.
function progress(frame: number, from: number, frames: number): number {
  return Math.min(1, Math.max(0, (frame - from + 1) / frames));
}

// Back-ease with a ~10% overshoot.
function easeOutBack(p: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

type Pass = { alpha: number; scale: number; dx: number; dy: number; ghosts: Ghost[]; dip: Look["dip"]; reveal: number | null };

const neutral = (): Pass => ({ alpha: 1, scale: 1, dx: 0, dy: 0, ghosts: [], dip: null, reveal: null });

function mediaEffect(clip: MediaClip, isIn: boolean, p: number, doc: Doc): Pass {
  const t = isIn ? clip.transitionIn : clip.transitionOut;
  const out = neutral();
  if (!t) return out;
  // The direction names the way the clip moves. An in-effect starts away on the opposite side and travels to rest; an
  // out-effect travels from rest away along the direction. `a` is the signed distance from rest, in frame sizes.
  const dir = t.direction ?? DEFAULT_DIRECTION;
  const [vx, vy] = VECTORS[dir];
  const sign = isIn ? -1 : 1;
  const a = (e: number) => sign * (isIn ? 1 - e : e);
  switch (t.kind) {
    case "fade":
    case "crossfade":
      out.alpha = isIn ? p : 1 - p;
      break;
    case "slide": {
      const o = a(ease(isIn ? "ease_out" : "ease_in", p));
      out.dx = vx * o;
      out.dy = vy * o;
      break;
    }
    case "zoom":
      out.scale = isIn ? 1.25 - 0.25 * p : 1 + 0.25 * p;
      out.alpha = isIn ? p : 1 - p;
      break;
    case "whip": {
      const o = a(ease("ease_in_out", p));
      out.dx = vx * o;
      out.dy = vy * o;
      // At rest there is nothing to trail. The clip always moves along the direction, so the trail sits behind it.
      if (!isIn || p < 1) {
        out.ghosts = GHOST_ALPHAS.map((alpha, i) => {
          const gap = GHOST_SPACING * (i + 1);
          return { dx: -vx * gap * doc.width, dy: -vy * gap * doc.height, alpha };
        });
      }
      break;
    }
    case "dip":
      out.dip = { color: t.color ?? DEFAULT_DIP_COLOR, alpha: isIn ? 1 - p : p };
      break;
  }
  return out;
}

const SLIDE_PRESETS: Record<string, Dir> = {
  slide_up: "up",
  slide_down: "down",
  slide_left: "left",
  slide_right: "right",
};

function textEffect(clip: TextClip, isIn: boolean, p: number): Pass {
  const a = isIn ? clip.animationIn : clip.animationOut;
  const out = neutral();
  if (!a) return out;
  const preset = a.preset;
  if (preset === "fade") {
    out.alpha = isIn ? p : 1 - p;
  } else if (preset === "pop") {
    const q = isIn ? p : 1 - p;
    // A scale of exactly 0 would break text drawing; alpha is 0 there anyway.
    out.scale = Math.max(0.001, easeOutBack(q));
    out.alpha = Math.min(1, 2 * q);
  } else if (preset in SLIDE_PRESETS) {
    const [vx, vy] = VECTORS[SLIDE_PRESETS[preset]];
    // 8% of the frame width for left and right, 8% of its height for up and down (offsets are in frame sizes).
    // The preset names the way the text moves, so an in-slide starts on the opposite side.
    const o = 0.08 * (isIn ? -(1 - ease("ease_out", p)) : ease("ease_in", p));
    out.dx = vx * o;
    out.dy = vy * o;
    out.alpha = isIn ? p : 1 - p;
  } else if (preset === "typewriter" && isIn) {
    out.reveal = Math.ceil(p * graphemes(clip.text).length - 1e-9);
  } else if (preset === "scale_punch" && isIn) {
    out.scale = 1.4 - 0.4 * ease("ease_out", p);
  }
  return out;
}

export function clipLook(clip: Clip, frame: number, doc: Doc): Look {
  const base = effectiveTransform(clip, frame);
  const look: Look = {
    transform: base,
    alpha: 1,
    ghosts: [],
    dip: null,
    reveal: null,
    litWord: null,
    litColor: null,
  };
  if (clip.type === "audio") return look;

  const { inFrames, outFrames } = effectWindows(clip);
  const passes: Pass[] = [];
  const effect = (isIn: boolean, p: number) =>
    clip.type === "text" ? textEffect(clip, isIn, p) : mediaEffect(clip, isIn, p, doc);
  if (inFrames > 0 && frame - clip.start < inFrames) passes.push(effect(true, progress(frame, clip.start, inFrames)));
  const outStart = clip.start + clip.duration - outFrames;
  if (outFrames > 0 && frame >= outStart) passes.push(effect(false, progress(frame, outStart, outFrames)));

  let x = base.x;
  let y = base.y;
  let scale = base.scale;
  let rotation = base.rotation;
  for (const pass of passes) {
    look.alpha *= pass.alpha;
    scale *= pass.scale;
    x += pass.dx;
    y += pass.dy;
    look.ghosts.push(...pass.ghosts);
    if (pass.dip) look.dip = pass.dip;
    if (pass.reveal !== null) look.reveal = pass.reveal;
  }

  if (clip.type === "text" && clip.emphasis) {
    const e = clip.emphasis;
    if (e.preset === "shake") {
      x += 0.006 * Math.sin(frame * 1.7);
      // The vertical jitter is a share of the width too, so a shake is the same distance in both directions.
      y += 0.006 * (doc.width / doc.height) * Math.sin(frame * 2.3 + 1);
      rotation += 1.5 * Math.sin(frame * 1.3);
    } else if (e.preset === "pulse") {
      scale *= 1 + 0.05 * Math.sin((2 * Math.PI * ((frame - clip.start) / doc.fps)) / 0.8);
    } else if (e.preset === "highlight_word") {
      const n = clip.text.split(/\s+/).filter(Boolean).length;
      if (n > 0) {
        look.litWord = Math.min(n - 1, Math.max(0, Math.floor(((frame - clip.start) / clip.duration) * n)));
        look.litColor = e.color ?? DEFAULT_HIGHLIGHT_COLOR;
      }
    }
  }

  look.transform = { ...base, x, y, scale, rotation };
  return look;
}
