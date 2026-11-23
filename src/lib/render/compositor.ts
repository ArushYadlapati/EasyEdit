import { captionsShow } from "@/lib/captions/cues";
import { graphemes } from "@/lib/text";
import { drawCaptions } from "./captions";
import { drawShape } from "./shapes";
import type { Clip, Crop, MediaClip, TextClip, TimelineDoc, Track, Transform } from "@/lib/timeline";
import { effectiveTransform } from "@/lib/timeline/keyframes";
import { isCropped, stretchOf } from "@/lib/timeline/presets";
import { adjustOf, isAdjusted, type FullAdjust } from "@/lib/timeline/adjust";
import { adjustFilter, compositeOf, needsLayer, temperatureColor } from "./adjust";
import { clipLook, effectWindows } from "./effects";
import { hasBackground, hasOutline, hasShadow, textExtras } from "@/lib/timeline/text-style";
import { layoutText, letterSpacingOf, textFont, textRect, type LocalRect, type TextLine } from "./text-layout";

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
  // A context on a canvas of this size for a picture that is finished on its own before it joins the frame, the
  // same one each time. Default: an OffscreenCanvas; null where there is none.
  makeLayer?: (width: number, height: number) => Ctx2D | null;
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
// outline: the pieces' outlines are drawn, not the pieces, so every outline can go under every letter.
function drawTextPieces(ctx: Ctx2D, clip: TextClip, lines: TextLine[], look: TextLook, measure: (s: string) => number, outline = false): void {
  const { color, align } = clip.style;
  ctx.textAlign = "left";
  let style = color;
  const placed = placeGraphemes(clip.text, lines);
  lines.forEach((line, n) => {
    const width = measure(line.text);
    const left = align === "left" ? line.x : align === "right" ? line.x - width : line.x - width / 2;
    const shown = look.reveal === null ? placed[n] : placed[n].filter((p) => p.at < look.reveal!);
    if (shown.length === 0) return;
    const text = shown.map((p) => p.g).join("");
    if (outline) {
      ctx.strokeText(text, left, line.y);
      return;
    }
    if (clip.style.underline) underline(ctx, clip, left, line.y, measure(text));
    if (look.litWord === null) {
      ctx.fillText(text, left, line.y);
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

// The line under underlined text: a tenth of the font size below the letters' feet, a fourteenth of it thick.
function underline(ctx: Ctx2D, clip: TextClip, left: number, y: number, width: number): void {
  const { fontSize } = clip.style;
  ctx.fillRect(left, y + fontSize * 0.42, width, Math.max(1, fontSize / 14));
}

// A #rrggbb colour at an opacity, as a canvas colour.
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// A rounded box path made with arcTo, so every canvas can take it.
function roundedBox(ctx: Ctx2D, box: LocalRect, r: number): void {
  const { left: l, top: t } = box;
  const w = box.right - l;
  const h = box.bottom - t;
  ctx.beginPath();
  ctx.moveTo(l + r, t);
  ctx.arcTo(l + w, t, l + w, t + h, r);
  ctx.arcTo(l + w, t + h, l, t + h, r);
  ctx.arcTo(l, t + h, l, t, r);
  ctx.arcTo(l, t, l + w, t, r);
  ctx.closePath();
}

function drawText(ctx: Ctx2D, doc: TimelineDoc, clip: TextClip, resolveFont: (family: string) => string, look: TextLook = PLAIN_TEXT): void {
  const { fontSize, fontFamily, color, align } = clip.style;
  const extras = textExtras(clip.style);
  const outlined = hasOutline(extras);
  const shadowed = hasShadow(extras);
  const boxed = hasBackground(extras);
  ctx.font = textFont(clip.style, resolveFont(fontFamily));
  const spacing = letterSpacingOf(clip.style);
  if (spacing !== null) ctx.letterSpacing = spacing;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const measure = (s: string) => ctx.measureText(s).width;
  const crop = clip.transform.crop;
  if (crop && isCropped(crop)) {
    const k = cropRect(textRect(clip, doc.width, measure), crop);
    // An uncut side moves out by the font size, so glyphs wider than their measured advance are not shaved, and by
    // whatever else the text draws around itself: its outline, its shadow and its box.
    const out =
      fontSize +
      (outlined ? extras.outlineWidth : 0) +
      (shadowed ? extras.shadowBlur + Math.max(Math.abs(extras.shadowX), Math.abs(extras.shadowY)) : 0) +
      (boxed ? extras.backgroundPadding * fontSize : 0);
    if (crop.left === 0) k.left -= out;
    if (crop.top === 0) k.top -= out;
    if (crop.right === 0) k.right += out;
    if (crop.bottom === 0) k.bottom += out;
    ctx.beginPath();
    ctx.rect(k.left, k.top, k.right - k.left, k.bottom - k.top);
    ctx.clip();
  }
  const lines = layoutText(clip, doc.width, measure);

  if (boxed) {
    // One box behind all the lines, as much larger than them as its padding, at its own opacity on top of the clip's.
    const r = textRect(clip, doc.width, measure);
    const pad = extras.backgroundPadding * fontSize;
    const box = { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * extras.backgroundOpacity;
    ctx.fillStyle = extras.backgroundColor;
    roundedBox(ctx, box, Math.min(extras.backgroundRadius * fontSize, (box.right - box.left) / 2, (box.bottom - box.top) / 2));
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
  }

  const pieces = look.reveal !== null || look.litWord !== null;
  const letters = (outline: boolean) => {
    if (pieces) {
      drawTextPieces(ctx, clip, lines, look, measure, outline);
      // The pieces are drawn from the left and in their own colours; the next pass starts as this one did.
      ctx.textAlign = align;
      ctx.fillStyle = color;
      return;
    }
    for (const line of lines) {
      if (outline) {
        ctx.strokeText(line.text, line.x, line.y);
        continue;
      }
      if (extras.underline) {
        const width = measure(line.text);
        underline(ctx, clip, align === "left" ? line.x : align === "right" ? line.x - width : line.x - width / 2, line.y, width);
      }
      ctx.fillText(line.text, line.x, line.y);
    }
  };
  if (!outlined && !shadowed) {
    // Plain text, the common case: one pass.
    if (pieces) drawTextPieces(ctx, clip, lines, look, measure);
    else letters(false);
    return;
  }
  if (outlined) {
    // Twice the width, since half of a canvas outline falls inside the letters, where the letters cover it.
    ctx.lineJoin = "round";
    ctx.lineWidth = extras.outlineWidth * 2;
    ctx.strokeStyle = extras.outlineColor;
  }
  if (shadowed) {
    // A canvas shadow ignores the drawing scale, so its blur and offsets are scaled by hand to stay the same share of
    // the picture in the preview, a thumbnail and an export.
    const m = ctx.getTransform();
    const k = Math.hypot(m.a, m.b);
    ctx.shadowColor = withAlpha(extras.shadowColor, extras.shadowOpacity);
    ctx.shadowBlur = extras.shadowBlur * k;
    ctx.shadowOffsetX = extras.shadowX * k;
    ctx.shadowOffsetY = extras.shadowY * k;
    if (outlined) letters(true);
    letters(false);
    ctx.shadowColor = "transparent";
    // With an outline the letters are drawn again without a shadow, so no letter's shadow lies on an outline.
    if (!outlined) return;
  }
  letters(true);
  letters(false);
}

// A canvas the size of the frame being drawn, kept between frames, for a picture that has to be finished on its own
// before it joins the frame. An OffscreenCanvas, which a page and a worker both have; null where there is none.
let sharedLayer: { width: number; height: number; ctx: Ctx2D } | null = null;

function defaultLayer(width: number, height: number): Ctx2D | null {
  if (sharedLayer && sharedLayer.width === width && sharedLayer.height === height) return sharedLayer.ctx;
  const ctx = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(width, height).getContext("2d");
  sharedLayer = ctx ? { width, height, ctx } : null;
  return ctx;
}

// A picture with its colour changes. What a canvas filter can do (brightness, contrast, saturation, hue, blur) is set
// as one. Warming, cooling and a vignette need the picture on a layer of its own first, so they touch nothing under it
// and nothing outside it; the finished layer is then drawn onto the frame with the clip's own opacity and blend.
// paint: draws the picture into a context. box: where it lands, in the clip's own pixels. cutout: the picture may
// have see-through parts (an image), which the warming must leave see-through.
function drawAdjusted(ctx: Ctx2D, adjust: FullAdjust, box: LocalRect, cutout: boolean, paint: (target: Ctx2D) => void, options: DrawOptions): void {
  const m = ctx.getTransform();
  const filter = adjustFilter(adjust, Math.hypot(m.a, m.b));
  const layer = needsLayer(adjust) ? (options.makeLayer ?? defaultLayer)(ctx.canvas.width, ctx.canvas.height) : null;
  if (!layer) {
    if (filter) ctx.filter = filter;
    paint(ctx);
    return;
  }
  const { width, height } = ctx.canvas;
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, width, height);
  layer.setTransform(m);
  if (filter) layer.filter = filter;
  paint(layer);
  if (filter) layer.filter = "none";
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  if (adjust.temperature !== 0) {
    layer.globalCompositeOperation = "multiply";
    layer.fillStyle = temperatureColor(adjust.temperature);
    layer.fillRect(box.left, box.top, w, h);
    if (cutout) {
      // The multiply filled the see-through parts too: the picture's own shape cuts them out again.
      layer.globalCompositeOperation = "destination-in";
      paint(layer);
    }
  }
  if (adjust.vignette > 0) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const reach = Math.hypot(w, h) / 2;
    const shade = layer.createRadialGradient(cx, cy, reach * 0.45, cx, cy, reach);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, `rgba(0,0,0,${adjust.vignette})`);
    layer.globalCompositeOperation = "source-atop";
    layer.fillStyle = shade;
    layer.fillRect(box.left, box.top, w, h);
  }
  layer.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.setTransform(m);
}

function drawMedia(ctx: Ctx2D, doc: TimelineDoc, clip: MediaClip & { type: "video" | "image" }, frame: number, options: DrawOptions): void {
  const source = options.resolveSource?.(clip, frame) ?? null;
  const size = mediaSize(doc, clip, source);
  const crop = clip.transform.crop;
  const k = cropRect(centred(size), crop);
  if (hasPicture(source)) {
    const { flipH, flipV } = clip.transform;
    if (flipH || flipV) {
      // Mirrored about the middle of what is shown, so a cropped picture stays where it is.
      const cx = (k.left + k.right) / 2;
      const cy = (k.top + k.bottom) / 2;
      ctx.translate(cx, cy);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.translate(-cx, -cy);
    }
    const paint = (target: Ctx2D) => {
      if (!crop || !isCropped(crop)) {
        target.drawImage(source.image, -size.width / 2, -size.height / 2, size.width, size.height);
        return;
      }
      const { width: sw, height: sh } = source;
      target.drawImage(
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
    };
    if (isAdjusted(clip.adjust)) drawAdjusted(ctx, adjustOf(clip.adjust), k, clip.type === "image", paint, options);
    else paint(ctx);
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
  const composite = clip.type === "placeholder" ? null : compositeOf(clip.blend);
  if (composite) ctx.globalCompositeOperation = composite;
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
