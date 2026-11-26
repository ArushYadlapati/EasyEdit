import { LIMITS } from "@/lib/limits";
import { isStorableText } from "@/lib/text";
import type { CaptionWord } from "@/lib/timeline";
import { ANALYSIS_LIMITS, type ColorFacts, type ShotFacts, type SpeechFacts } from "./types";

// What a style learns from one of the space's own videos, worked out from what a browser measured in it: how it is
// cut, what its colours are, what is said, and which frames go in its strip. Pure: no browser globals, so the page
// runs it on decoded frames and words and tests run it on made-up ones.

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function median(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Shots ---

// The facts about a run of shots from how long each one is, in seconds, and how long the whole video or project is:
// seconds to 0.1 (and never more than the whole, to two places, so they still check against it), and shots a minute
// to 0.1. No shots, or no length: all 0. Past projects use this too, with their clips' lengths.
export function shotFactsOf(lengths: readonly number[], seconds: number): ShotFacts {
  const shots = lengths.filter((n) => Number.isFinite(n) && n > 0);
  const whole = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (shots.length === 0 || whole === 0) return { count: 0, averageSeconds: 0, medianSeconds: 0, firstSeconds: 0, perMinute: 0 };
  const fit = (n: number) => Math.min(round(n, 1), round(whole, 2), ANALYSIS_LIMITS.projectSeconds);
  const total = shots.reduce((a, b) => a + b, 0);
  return {
    count: Math.min(shots.length, 1_000_000),
    averageSeconds: fit(total / shots.length),
    medianSeconds: fit(median([...shots].sort((a, b) => a - b))),
    firstSeconds: fit(shots[0]),
    perMinute: clamp(round((shots.length / whole) * 60, 1), 0, 3600),
  };
}

// Where each shot starts and the last one ends: 0, every cut inside the video (in order, each once), and its length.
function shotBounds(cuts: readonly number[], seconds: number): number[] {
  const inside = cuts.filter((t) => Number.isFinite(t) && t > 0 && t < seconds).sort((a, b) => a - b);
  return [0, ...inside.filter((t, i) => i === 0 || t > inside[i - 1]), seconds];
}

// How a video is cut, from the times its shots change (seconds, as a cut finder gives them) and its length: how many
// shots, their average and middle length, the first one's length (often the hook) and how many start a minute.
export function shotStats(cuts: readonly number[], seconds: number): ShotFacts {
  if (!(seconds > 0)) return shotFactsOf([], 0);
  const bounds = shotBounds(cuts, seconds);
  return shotFactsOf(bounds.slice(1).map((end, i) => end - bounds[i]), seconds);
}

// The cut times a video's facts keep, from the times a cut finder gave: inside the video, in seconds to two places, in
// order and each once (times that round to the same one are one cut), and at most 400, picked evenly through the
// video when there are more.
export function cutList(cuts: readonly number[], seconds: number): number[] {
  if (!(seconds > 0)) return [];
  const times = [...new Set(cuts.filter((t) => Number.isFinite(t)).map((t) => round(t, 2)))]
    .filter((t) => t > 0 && t < seconds)
    .sort((a, b) => a - b);
  const most = ANALYSIS_LIMITS.cuts;
  if (times.length <= most) return times;
  return Array.from({ length: most }, (_, k) => times[Math.floor(((k + 0.5) * times.length) / most)]);
}

// --- Colour ---

// About how many pixels of each frame are looked at; enough for an average, and cheap.
const COLOR_SAMPLES = 4096;

// Adds up a video's colours frame by frame: how bright (luma), how colourful (saturation, HSV-style) and how warm (red
// against blue). frames says how many have been added.
export type ColorMeter = {
  add(rgba: Uint8ClampedArray, width: number, height: number): void;
  frames(): number;
  result(): ColorFacts;
};

// A colour meter: give it small RGBA frames as they are decoded, then read the average. Each frame counts the same
// however big it is. The result is brightness and saturation from 0 to 1 and warmth from -1 (blue) to 1 (orange), to
// two places; all 0 when no frame was added.
export function createColorMeter(): ColorMeter {
  let frames = 0;
  let brightness = 0;
  let saturation = 0;
  let warmth = 0;
  return {
    add(rgba, width, height) {
      const pixels = Math.min(Math.max(0, Math.floor(width) * Math.floor(height)), Math.floor(rgba.length / 4));
      if (!(pixels > 0)) return; // no pixels, or a size that isn't a number
      const step = Math.max(1, Math.floor(pixels / COLOR_SAMPLES));
      let n = 0;
      let luma = 0;
      let sat = 0;
      let warm = 0;
      for (let p = 0; p < pixels; p += step) {
        const i = p * 4;
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        const most = Math.max(r, g, b);
        luma += 0.299 * r + 0.587 * g + 0.114 * b;
        sat += most === 0 ? 0 : (most - Math.min(r, g, b)) / most;
        warm += r - b;
        n++;
      }
      brightness += luma / n / 255;
      saturation += sat / n;
      warmth += warm / n / 255;
      frames++;
    },
    frames: () => frames,
    result() {
      if (frames === 0) return { brightness: 0, saturation: 0, warmth: 0 };
      return {
        brightness: clamp(round(brightness / frames, 2), 0, 1),
        saturation: clamp(round(saturation / frames, 2), 0, 1),
        warmth: clamp(round(warmth / frames, 2), -1, 1),
      };
    },
  };
}

// --- Speech ---

// A pause shorter than this, in milliseconds, still counts as talking (it is where a caption line would carry on).
const TALKING_GAP_MS = 600;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;

// What is said in a video, from its words (as a transcriber gives them) and its length in seconds: how many words, how
// many a minute, the first words (at most 30, counted as the facts count them, so a "word" with a space in it is two;
// ending at the first sentence's end if that comes sooner, and short enough to keep), and the share of the video with
// someone talking (word times joined over pauses under 0.6 s). null when fewer than 3 words were heard, which is a
// video with no talking in it.
export function speechStats(words: readonly CaptionWord[], seconds: number): SpeechFacts | null {
  const said = words
    .filter((w) => typeof w?.t === "string" && w.t.trim() !== "" && isStorableText(w.t) && Number.isFinite(w.s) && Number.isFinite(w.e))
    .map((w) => ({ t: w.t.trim(), s: w.s, e: Math.max(w.s, w.e) }))
    .sort((a, b) => a.s - b.s);
  if (said.length < 3) return null;
  const count = Math.min(said.length, LIMITS.captionWordsPerFile);
  const length = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  const opening: string[] = [];
  let chars = 0;
  for (const word of said.slice(0, ANALYSIS_LIMITS.openingWords).flatMap((w) => w.t.split(/\s+/u))) {
    const add = (opening.length > 0 ? 1 : 0) + word.length;
    if (opening.length === ANALYSIS_LIMITS.openingWords || chars + add > ANALYSIS_LIMITS.openingChars) break;
    opening.push(word);
    chars += add;
    if (SENTENCE_END.test(word)) break;
  }

  let talking = 0;
  let from = said[0].s;
  let to = said[0].e;
  for (const word of said.slice(1)) {
    if (word.s - to < TALKING_GAP_MS) {
      to = Math.max(to, word.e);
      continue;
    }
    talking += to - from;
    from = word.s;
    to = word.e;
  }
  talking += to - from;

  return {
    words: count,
    perMinute: length > 0 ? clamp(Math.round((count / length) * 60), 0, 1000) : 0,
    opening: opening.join(" "),
    talkingShare: length > 0 ? clamp(round(talking / 1000 / length, 2), 0, 1) : 0,
  };
}

// --- The strip of frames ---

// Frames in the strip closer together than this, in seconds, are one frame.
const SHEET_APART = 0.05;

// When to take the frames for a video's strip, in seconds to two places, in order: one at 0.2 s (the first thing
// people see; the middle of a video under 0.4 s), then the rest from the middles of its shots, spread evenly over
// them. With more shots than room, shots are picked evenly through the video; with fewer, the longer shots give more
// than one frame, from the middles of equal parts of them. Of frames under 0.05 s apart only one is kept, and the
// first frame is never the one dropped. At most max, and never more than a strip holds (12).
export function sheetTimes(cuts: readonly number[], seconds: number, max: number = ANALYSIS_LIMITS.sheetFrames): number[] {
  if (!(seconds > 0)) return [0];
  const most = Number.isFinite(max) ? clamp(Math.floor(max), 1, ANALYSIS_LIMITS.sheetFrames) : ANALYSIS_LIMITS.sheetFrames;
  const room = most - 1;
  const times = [seconds < 0.4 ? seconds / 2 : 0.2];
  const bounds = shotBounds(cuts, seconds);
  const shots = bounds.slice(1).map((end, i) => ({ start: bounds[i], length: end - bounds[i] }));
  if (room > 0 && shots.length >= room) {
    for (let k = 0; k < room; k++) {
      const shot = shots[Math.floor(((k + 0.5) * shots.length) / room)];
      times.push(shot.start + shot.length / 2);
    }
  } else if (room > 0) {
    // Every shot gets a frame; each one left over goes to the shot whose parts are now the longest.
    const parts = shots.map(() => 1);
    for (let left = room - shots.length; left > 0; left--) {
      let best = 0;
      for (let i = 1; i < shots.length; i++) if (shots[i].length / parts[i] > shots[best].length / parts[best]) best = i;
      parts[best]++;
    }
    shots.forEach((shot, i) => {
      for (let j = 0; j < parts[i]; j++) times.push(shot.start + ((j + 0.5) * shot.length) / parts[i]);
    });
  }
  // The first frame always stays; each other one stays when it is far enough from every frame kept so far.
  const [first, ...rest] = times.map((t) => Math.min(round(t, 2), seconds));
  const kept = [first];
  for (const t of rest.sort((a, b) => a - b)) {
    if (kept.every((k) => Math.abs(t - k) >= SHEET_APART - 1e-9)) kept.push(t);
  }
  return kept.sort((a, b) => a - b);
}

// How a video's strip of frames is laid out: columns and rows of tiles, each tile's size in pixels (its long side is
// tile, its short side keeps the video's shape), and the whole strip's size.
export type SheetGrid = { columns: number; rows: number; tileW: number; tileH: number; width: number; height: number };

// The grid for count frames of a video frameW by frameH: 4 columns for a tall video and 3 for a wide or square one,
// fewer when there are fewer frames, and as many rows as that needs. A video with no size is taken as square.
export function sheetGrid(count: number, frameW: number, frameH: number, tile = 240): SheetGrid {
  const frames = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  const w = Number.isFinite(frameW) && frameW > 0 ? frameW : 1;
  const h = Number.isFinite(frameH) && frameH > 0 ? frameH : 1;
  const side = Number.isFinite(tile) ? Math.max(1, Math.round(tile)) : 240;
  const portrait = h > w;
  const columns = Math.min(portrait ? 4 : 3, frames);
  const rows = Math.ceil(frames / columns);
  const short = Math.max(1, Math.round((side * Math.min(w, h)) / Math.max(w, h)));
  const tileW = portrait ? short : side;
  const tileH = portrait ? side : short;
  return { columns, rows, tileW, tileH, width: columns * tileW, height: rows * tileH };
}
