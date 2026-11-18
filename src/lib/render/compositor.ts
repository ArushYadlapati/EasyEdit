import { captionsShow } from "@/lib/captions/cues";
import { graphemes } from "@/lib/text";
import { drawCaptions } from "./captions";
import { drawShape } from "./shapes";
import type { Clip, Crop, MediaClip, TextClip, TimelineDoc, Track, Transform } from "@/lib/timeline";
import { effectiveTransform } from "@/lib/timeline/keyframes";
import { isCropped, stretchOf } from "@/lib/timeline/presets";
import { clipLook, effectWindows } from "./effects";
import { layoutText, textRect, type LocalRect, type TextLine } from "./text-layout";

export type { LocalRect };

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ResolvedSource = { image: CanvasImageSource; width: number; height: number };
export type DrawOptions = {
  // The seam where media plugs in. clip: the video or image clip being drawn. frame: the timeline frame being drawn.
  resolveSource?: (clip: MediaClip, frame: number) => ResolvedSource | null;
  // What a clip with no picture says in its placeholder. Default: "Video" or "Image".
  placeholderLabel?: (clip: MediaClip) => string;
  resolveFont?: (family: string) => string; // a document font name to a CSS font-family list
  // A clip left out: the preview's in-place text box shows that text instead. Never set for an export.
  hideClipId?: string;
};

// Repeats the --ed-clip-video and --ed-clip-image colors from src/app/globals.css, because a worker cannot read CSS variables.
export const PLACEHOLDER_FILL = { video: "#2c3d5c", image: "#3b3160" } as const;

export function defaultResolveFont(family: string): string {
  return `"${family}", sans-serif`;
}

export function activeClips(doc: TimelineDoc, frame: number): { track: Track; clip: Clip }[] {
  const active: { track: Track; clip: Clip }[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type === "audio" || (clip.type === "placeholder" && clip.accepts === "audio")) continue;
      if (clip.start <= frame && frame < clip.start + clip.duration) active.push({ track, clip });
    }
  }
  return active;
}

// tail: an outgoing clip drawn on past its cut, under the clip that crossfades in over it.
export type DrawnClip = { track: Track; clip: Clip; tail: boolean };

// The clip a crossfade blends from: the one on the same track that ends exactly where this one starts. An empty slot
// has no picture to blend from, so a crossfade after one plays as if nothing came before it.
export function crossfadeFrom(track: Track, clip: Clip): Clip | null {
  if (clip.type !== "video" && clip.type !== "image") return null;
  if (clip.transitionIn?.kind !== "crossfade") return null;
  return track.clips.find((c) => c.type !== "audio" && c.type !== "placeholder" && c.start + c.duration === clip.start) ?? null;
}

// A crossfade owns its cut: the outgoing clip draws whole up to it and on under the incoming one. Its own
// out-transition would fade or dip it to nothing and then have it pop back at full alpha in its tail. So a clip that
// the next one crossfades in from draws as if it had no out-transition. Everything that times a crossfade or draws a
// clip reads the clip as drawn, so the incoming clip's window and its outgoing clip's tail always match.
export function asDrawn(track: Track, clip: Clip): Clip {
  if ((clip.type !== "video" && clip.type !== "image") || !clip.transitionOut) return clip;
  return crossfadeInto(track, clip) ? { ...clip, transitionOut: null } : clip;
}

// How many frames this clip crossfades in over its outgoing clip, as it draws: 0 with no crossfade, no clip to blend
// from, or a clip too short to hold any of it.
export function crossfadeFrames(track: Track, clip: Clip): number {
  if (!crossfadeFrom(track, clip)) return 0;
  return effectWindows(asDrawn(track, clip)).inFrames;
}

// The outgoing clip drawn under this one at a frame, while its crossfade runs; null outside it.
export function tailAt(track: Track, clip: Clip, frame: number): Clip | null {
  if (frame < clip.start || frame - clip.start >= crossfadeFrames(track, clip)) return null;
  return crossfadeFrom(track, clip);
}

// The clip that crossfades in from this one: the one on the same track that starts where it ends, if its crossfade has
// any frames. A crossfade with none leaves the cut, and this clip's own out-transition, as they are.
export function crossfadeInto(track: Track, clip: Clip): Clip | null {
  const end = clip.start + clip.duration;
  const next = track.clips.find((c) => c.start === end && crossfadeFrom(track, c) === clip);
  return next && crossfadeFrames(track, next) > 0 ? next : null;
}

// What is drawn at a frame, back to front: the clips under it, each crossfade's outgoing clip right before the clip
// fading in over it. An empty slot draws nothing (the editor outlines it), so it is never in the list.
export function drawnClips(doc: TimelineDoc, frame: number): DrawnClip[] {
  const drawn: DrawnClip[] = [];
  for (const { track, clip } of activeClips(doc, frame)) {
    if (clip.type === "placeholder") continue;
    const from = tailAt(track, clip, frame);
    if (from) drawn.push({ track, clip: from, tail: true });
    drawn.push({ track, clip, tail: false });
  }
  return drawn;
}

export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number, fit: "cover" | "contain"): { width: number; height: number } {
  const ratio = fit === "cover" ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  return { width: srcW * ratio, height: srcH * ratio };
}

// The size a video or image is drawn at before scale, stretch and rotation: fitted to the frame, or the whole frame for a placeholder.
export function mediaSize(
  doc: { width: number; height: number },
  clip: MediaClip,
  source: { width: number; height: number } | null,
): { width: number; height: number } {
  if (!hasPicture(source)) return { width: doc.width, height: doc.height };
  return fitRect(source.width, source.height, doc.width, doc.height, clip.transform.fit);
}

// A source with no size (a video before its metadata, or with no video track) draws a placeholder.
function hasPicture<T extends { width: number; height: number }>(source: T | null | undefined): source is T {
  return !!source && source.width > 0 && source.height > 0;
}

// What is left of a box once each side's share of its width or height is cut away.
export function cropRect(rect: LocalRect, crop: Crop | undefined): LocalRect {
  if (!crop) return { ...rect };
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  return { left: rect.left + crop.left * w, top: rect.top + crop.top * h, right: rect.right - crop.right * w, bottom: rect.bottom - crop.bottom * h };
}

const centred = ({ width, height }: { width: number; height: number }): LocalRect => ({ left: -width / 2, top: -height / 2, right: width / 2, bottom: height / 2 });

// reveal: how many of the text's graphemes are drawn (null, all). litWord: which of its words is drawn in litColor.
type TextLook = { reveal: number | null; litWord: number | null; litColor: string | null };
const PLAIN_TEXT: TextLook = { reveal: null, litWord: null, litColor: null };

type Placed = { g: string; at: number; word: number };

// Each line's graphemes, with where each sits in the clip's text and which of its words it is in (−1 for a space).
// Lines leave out only the spaces and breaks they wrap at, so each line grapheme is the next equal one in the text,
// and a word cut across two lines stays one word. A wrap can split a cluster (a space with a combining mark), leaving
// a grapheme the text does not have on its own: it is drawn with the word around it, and the search stays put, so
// the graphemes after it are still found.
function placeGraphemes(text: string, lines: TextLine[]): Placed[][] {
  const all = graphemes(text);
  const wordOf: number[] = [];
  let word = -1;
  let inWord = false;
  for (const g of all) {
    const space = /^\s+$/.test(g);
    if (!space && !inWord) word++;
    inWord = !space;
    wordOf.push(space ? -1 : word);
  }
  let i = 0;
  let lastWord = -1; // the word of the last grapheme placed that was in one
  return lines.map((line) =>
    graphemes(line.text).map((g) => {
      let j = i;
      while (j < all.length && all[j] !== g) j++;
      if (j === all.length) {
        const at = Math.max(0, Math.min(i, all.length - 1));
        const word = wordOf[at] !== undefined && wordOf[at] !== -1 ? wordOf[at] : lastWord;
        return { g, at, word };
      }
      i = j + 1;
      if (wordOf[j] !== -1) lastWord = wordOf[j];
      return { g, at: j, word: wordOf[j] };
    }),
  );
}

// Draws a typed-in prefix or one word at a time. Each piece is drawn left-aligned from where the whole line starts,
// so it lands where it sits in the line, whatever the line's alignment.
function drawTextPieces(ctx: Ctx2D, clip: TextClip, lines: TextLine[], look: TextLook, measure: (s: string) => number): void {
  const { color, align } = clip.style;
  ctx.textAlign = "left";
  let style = color;
  const placed = placeGraphemes(clip.text, lines);
  lines.forEach((line, n) => {
    const width = measure(line.text);
    const left = align === "left" ? line.x : align === "right" ? line.x - width : line.x - width / 2;
    const shown = look.reveal === null ? placed[n] : placed[n].filter((p) => p.at < look.reveal!);
    if (shown.length === 0) return;
    if (look.litWord === null) {
      ctx.fillText(shown.map((p) => p.g).join(""), left, line.y);
      return;
    }
    let i = 0;
    while (i < shown.length) {
      if (shown[i].word === -1) {
        i++;
        continue;
      }
      let j = i;
      while (j < shown.length && shown[j].word === shown[i].word) j++;
      const want = shown[i].word === look.litWord ? (look.litColor ?? color) : color;
      if (want !== style) {
        ctx.fillStyle = want;
        style = want;
      }
      const before = shown.slice(0, i).map((p) => p.g).join("");
      ctx.fillText(shown.slice(i, j).map((p) => p.g).join(""), left + measure(before), line.y);
      i = j;
    }
  });
}

function drawText(ctx: Ctx2D, doc: TimelineDoc, clip: TextClip, resolveFont: (family: string) => string, look: TextLook = PLAIN_TEXT): void {
  const { fontWeight, fontSize, fontFamily, color, align } = clip.style;
  ctx.font = `${fontWeight} ${fontSize}px ${resolveFont(fontFamily)}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const measure = (s: string) => ctx.measureText(s).width;
  const crop = clip.transform.crop;
  if (crop && isCropped(crop)) {
    const k = cropRect(textRect(clip, doc.width, measure), crop);
    // An uncut side moves out by the font size, so glyphs wider than their measured advance are not shaved.
    if (crop.left === 0) k.left -= fontSize;
    if (crop.top === 0) k.top -= fontSize;
    if (crop.right === 0) k.right += fontSize;
    if (crop.bottom === 0) k.bottom += fontSize;
    ctx.beginPath();
    ctx.rect(k.left, k.top, k.right - k.left, k.bottom - k.top);
    ctx.clip();
  }
  const lines = layoutText(clip, doc.width, measure);
  if (look.reveal !== null || look.litWord !== null) drawTextPieces(ctx, clip, lines, look, measure);
  else for (const line of lines) ctx.fillText(line.text, line.x, line.y);
}

function drawMedia(ctx: Ctx2D, doc: TimelineDoc, clip: MediaClip & { type: "video" | "image" }, frame: number, options: DrawOptions): void {
  const source = options.resolveSource?.(clip, frame) ?? null;
  const size = mediaSize(doc, clip, source);
  const crop = clip.transform.crop;
  const k = cropRect(centred(size), crop);
  if (hasPicture(source)) {
    if (!crop || !isCropped(crop)) {
      ctx.drawImage(source.image, -size.width / 2, -size.height / 2, size.width, size.height);
      return;
    }
    const { width: sw, height: sh } = source;
    ctx.drawImage(
      source.image,
      crop.left * sw,
      crop.top * sh,
      sw - crop.left * sw - crop.right * sw,
      sh - crop.top * sh - crop.bottom * sh,
      k.left,
      k.top,
      k.right - k.left,
      k.bottom - k.top,
    );
    return;
  }
  ctx.fillStyle = PLACEHOLDER_FILL[clip.type];
  ctx.fillRect(k.left, k.top, k.right - k.left, k.bottom - k.top);
  ctx.fillStyle = "#ededed";
  ctx.font = `500 ${Math.round(doc.width * 0.04)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(options.placeholderLabel?.(clip) ?? (clip.type === "video" ? "Video" : "Image"), (k.left + k.right) / 2, (k.top + k.bottom) / 2);
}

// One clip at a transform and alpha, moved dx, dy project pixels before it is turned (a whip's trail).
function drawClip(
  ctx: Ctx2D,
  doc: TimelineDoc,
  clip: Clip,
  frame: number,
  draw: { t: Transform; alpha: number; dx: number; dy: number; text: TextLook },
  options: DrawOptions,
  resolveFont: (family: string) => string,
): void {
  const { t } = draw;
  ctx.save();
  ctx.globalAlpha = draw.alpha;
  ctx.translate(t.x * doc.width + draw.dx, t.y * doc.height + draw.dy);
  ctx.rotate((t.rotation * Math.PI) / 180);
  // A stretch widens text glyphs too. Wrapping happens in local units, so it does not change.
  ctx.scale(t.scale * stretchOf(t), t.scale);
  if (clip.type === "text") drawText(ctx, doc, clip, resolveFont, draw.text);
  else if (clip.type === "shape") drawShape(ctx, clip);
  else if (clip.type === "video" || clip.type === "image") drawMedia(ctx, doc, clip as MediaClip & { type: "video" | "image" }, frame, options);
  ctx.restore();
}

// Draws in project pixels and never reads the canvas size: a caller that wants a smaller canvas scales the context first.
export function drawFrame(ctx: Ctx2D, doc: TimelineDoc, frame: number, options: DrawOptions = {}): void {
  const resolveFont = options.resolveFont ?? defaultResolveFont;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, doc.width, doc.height);
  // Captions sit at their track's place in the stack: after the clips on tracks before it, before those after it.
  const captionAt = captionsShow(doc) ? doc.tracks.findIndex((t) => t.kind === "caption") : -1;
  let captionsDrawn = captionAt < 0;
  for (const { track, clip, tail } of drawnClips(doc, frame)) {
    if (!captionsDrawn && doc.tracks.indexOf(track) > captionAt) {
      drawCaptions(ctx, doc, frame, resolveFont);
      captionsDrawn = true;
    }
    if (clip.id === options.hideClipId) continue;
    if (tail) {
      // Under a crossfade the outgoing clip plays on as it is: its own out-transition belongs to the cut, not the blend.
      const t = effectiveTransform(clip, frame);
      drawClip(ctx, doc, clip, frame, { t, alpha: t.opacity, dx: 0, dy: 0, text: PLAIN_TEXT }, options, resolveFont);
      continue;
    }
    const look = clipLook(asDrawn(track, clip), frame, doc);
    const t = look.transform;
    const alpha = t.opacity * look.alpha;
    for (const ghost of look.ghosts) {
      drawClip(ctx, doc, clip, frame, { t, alpha: alpha * ghost.alpha, dx: ghost.dx, dy: ghost.dy, text: look }, options, resolveFont);
    }
    drawClip(ctx, doc, clip, frame, { t, alpha, dx: 0, dy: 0, text: look }, options, resolveFont);
    if (look.dip && look.dip.alpha > 0) {
      ctx.save();
      ctx.globalAlpha = look.dip.alpha;
      ctx.fillStyle = look.dip.color;
      ctx.fillRect(0, 0, doc.width, doc.height);
      ctx.restore();
    }
  }
  if (!captionsDrawn) drawCaptions(ctx, doc, frame, resolveFont);
}
