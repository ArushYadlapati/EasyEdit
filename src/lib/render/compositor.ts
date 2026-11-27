import { captionsShow } from "@/lib/captions/cues";
import { graphemes } from "@/lib/text";
import { drawCaptions } from "./captions";
import { drawShape } from "./shapes";
import type { AdjustmentClip, Clip, Crop, Grade, Mask, MediaClip, NestClip, TextClip, TextSpan, TimelineDoc, Track, Transform } from "@/lib/timeline";
import { nestFrame, nestTracks } from "@/lib/timeline/nest";
import { moveAt } from "@/lib/media/steady";
import { adjustAt, effectiveTransform } from "@/lib/timeline/keyframes";
import { isCropped, stretchOf } from "@/lib/timeline/presets";
import { STYLE_KEYS, TONE_KEYS, type FullAdjust } from "@/lib/timeline/adjust";
import { adjustFilter, compositeOf, needsLayer, temperatureColor } from "./adjust";
import { createFinisher, type FinishPass, type Finisher } from "./finish-gl";
import { bakeGrade } from "./grade";
import { keyOut, type ChromaKey } from "./chroma";
import { clipLook, effectWindows, type Smear } from "./effects";
import { hasBackground, hasOutline, hasShadow, textExtras } from "@/lib/timeline/text-style";
import { alignShift, layoutText, letterSpacingOf, lettersWidth, spanRuns, textFont, textRect, type LocalRect, type StyledMeasure, type TextLine } from "./text-layout";

export type { LocalRect };

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ResolvedSource = { image: CanvasImageSource; width: number; height: number };
export type LayerUse = "tone" | "finish" | "under" | "mask" | "nest" | "motion" | "motion-spread";
export type DrawOptions = {
  // The seam where media plugs in. clip: the video or image clip being drawn. frame: the timeline frame being drawn.
  resolveSource?: (clip: MediaClip, frame: number) => ResolvedSource | null;
  // What a clip with no picture says in its placeholder. Default: "Video" or "Image".
  placeholderLabel?: (clip: MediaClip) => string;
  resolveFont?: (family: string) => string; // a document font name to a CSS font-family list
  // A clip left out: the preview's in-place text box shows that text instead. Never set for an export.
  hideClipId?: string;
  // A caption line left out (cueKeyText), which the preview's in-place caption box shows instead. Never set for an export.
  hideCue?: string;
  // A context on a canvas of this size for a picture that is finished on its own before it joins the frame, the
  // same one each time for the same use: "tone" for a picture being warmed, cooled or vignetted, "finish" for one on
  // its way to the graphics card, "under" for the copy of the frame an adjustment layer works on, "mask" for a
  // picture being cut to its mask, "nest" for a nest's clips drawn together before the nest is placed, "motion" for a
  // whipping clip drawn on its own before it is smeared along its move, and "motion-spread" for the other half of each
  // step of that smear. Default: an OffscreenCanvas; null where there is none.
  makeLayer?: (width: number, height: number, use: LayerUse) => Ctx2D | null;
  // What grades a picture and draws its stylised effects (finish-gl.ts). Default: one on the graphics card, shared;
  // null draws every picture without them.
  finish?: Finisher | null;
  // The same for a picture whose key colour is being taken out: a context on a canvas of the picture's own size.
  makeKeyLayer?: (width: number, height: number) => Ctx2D | null;
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
      // Sound has no picture, and an adjustment layer has none of its own: drawFrame works it in by itself. Captions
      // are drawn from their lines (drawCaptions), at their track's place.
      if (clip.type === "audio" || clip.type === "adjustment" || clip.type === "caption" || (clip.type === "placeholder" && clip.accepts === "audio")) continue;
      if (clip.start <= frame && frame < clip.start + clip.duration) active.push({ track, clip });
    }
  }
  return active;
}

// The adjustment layers on at a frame, in track order: each changes what the tracks before its own have drawn.
export function adjustmentsAt(doc: TimelineDoc, frame: number): { track: Track; clip: AdjustmentClip }[] {
  const on: { track: Track; clip: AdjustmentClip }[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type === "adjustment" && clip.start <= frame && frame < clip.start + clip.duration) on.push({ track, clip });
    }
  }
  return on;
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
    if (clip.style.underline) underline(ctx, clip, left, line.y, lettersWidth(clip.style, text, measure(text)));
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

// A text with styled spans, drawn stretch by stretch: each in its own font and colour, from where the one before it
// ended. A typed-in reveal shows only the characters reached so far, and a lit word takes its colour over its span's.
// outline: the stretches' outlines are drawn, not the stretches. It leaves the font, colour and alignment as the
// clip's own, for whatever is drawn next.
function drawStyledLines(ctx: Ctx2D, clip: TextClip, lines: TextLine[], look: TextLook, fontOf: (span: TextSpan | null) => string, outline: boolean): void {
  const { color, align } = clip.style;
  const measure = (s: string) => ctx.measureText(s).width;
  ctx.textAlign = "left";
  for (const line of lines) {
    const cells = line.cells ?? [];
    const width = line.width ?? 0;
    let x = align === "left" ? line.x : align === "right" ? line.x - width : line.x - width / 2;
    for (const run of spanRuns(cells)) {
      ctx.font = fontOf(run.span);
      const whole = run.cells.map((cell) => cell.g).join("");
      const shown = look.reveal === null ? run.cells : run.cells.filter((cell) => cell.at < look.reveal!);
      if (shown.length > 0) {
        const text = shown.map((cell) => cell.g).join("");
        const own = run.span?.color ?? color;
        if (outline) ctx.strokeText(text, x, line.y);
        else {
          ctx.fillStyle = own;
          if (run.span?.underline ?? clip.style.underline) underline(ctx, clip, x, line.y, lettersWidth(clip.style, text, measure(text)));
          if (look.litWord === null) ctx.fillText(text, x, line.y);
          else {
            // Word by word, so the lit one can take its colour.
            let i = 0;
            while (i < shown.length) {
              let j = i + 1;
              while (j < shown.length && shown[j].word === shown[i].word) j++;
              ctx.fillStyle = shown[i].word !== -1 && shown[i].word === look.litWord ? (look.litColor ?? own) : own;
              ctx.fillText(shown.slice(i, j).map((cell) => cell.g).join(""), x + measure(shown.slice(0, i).map((cell) => cell.g).join("")), line.y);
              i = j;
            }
          }
        }
      }
      x += measure(whole);
    }
  }
  ctx.font = fontOf(null);
  ctx.fillStyle = color;
  ctx.textAlign = align;
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
  // A text with styled spans: each stretch has its own font (its weight and slant) and is measured in it.
  const family = resolveFont(fontFamily);
  const fontOf = (span: TextSpan | null) =>
    textFont(span ? { ...clip.style, fontWeight: span.fontWeight ?? clip.style.fontWeight, italic: span.italic ?? clip.style.italic } : clip.style, family);
  const styled: StyledMeasure | undefined =
    clip.spans && clip.spans.length > 0
      ? (text, span) => {
          if (!span || (span.fontWeight === undefined && span.italic === undefined)) return ctx.measureText(text).width;
          ctx.font = fontOf(span);
          const width = ctx.measureText(text).width;
          ctx.font = fontOf(null);
          return width;
        }
      : undefined;
  const crop = clip.transform.crop;
  if (crop && isCropped(crop)) {
    const k = cropRect(textRect(clip, doc.width, measure, styled), crop);
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
  const lines = layoutText(clip, doc.width, measure, styled);

  if (boxed) {
    // One box behind all the lines, as much larger than them as its padding, at its own opacity on top of the clip's.
    const r = textRect(clip, doc.width, measure, styled);
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

  // With room between its letters, a line is measured wider than its letters by the room after the last one, and a
  // canvas centres or right-aligns that whole width: the letters are moved back to where the alignment means them.
  const shift = spacing === null ? 0 : alignShift(clip.style);
  if (shift !== 0) ctx.translate(shift, 0);
  const pieces = look.reveal !== null || look.litWord !== null;
  const letters = (outline: boolean) => {
    if (styled) {
      drawStyledLines(ctx, clip, lines, look, fontOf, outline);
      return;
    }
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
        underline(ctx, clip, align === "left" ? line.x : align === "right" ? line.x - width : line.x - width / 2, line.y, lettersWidth(clip.style, line.text, width));
      }
      ctx.fillText(line.text, line.x, line.y);
    }
  };
  if (!outlined && !shadowed) {
    // Plain text, the common case: one pass.
    if (pieces && !styled) drawTextPieces(ctx, clip, lines, look, measure);
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

// Canvases the size of the frame being drawn, kept between frames, one for each use, for a picture that has to be
// finished on its own before it joins the frame. OffscreenCanvases, which a page and a worker both have; null where
// there are none.
const sharedLayers = new Map<LayerUse, { width: number; height: number; ctx: Ctx2D }>();

function defaultLayer(width: number, height: number, use: LayerUse): Ctx2D | null {
  const kept = sharedLayers.get(use);
  if (kept && kept.width === width && kept.height === height) return kept.ctx;
  const ctx = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(width, height).getContext("2d");
  if (ctx) sharedLayers.set(use, { width, height, ctx });
  else sharedLayers.delete(use);
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
  const layer = needsLayer(adjust) ? (options.makeLayer ?? defaultLayer)(ctx.canvas.width, ctx.canvas.height, "tone") : null;
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

// The finisher every frame shares unless a caller brings its own: made the first time a picture needs one.
let sharedFinisher: Finisher | undefined;

// What the graphics card is to do to a picture: its grade and its stylised effects. Null when it has neither, which
// is every picture until one is set, so a plain picture never goes near the card.
function finishOf(ctx: Ctx2D, doc: TimelineDoc, clip: { grade?: Grade }, adjust: FullAdjust, frame: number): FinishPass | null {
  const grade = bakeGrade(clip.grade, doc.luts);
  if (!grade && STYLE_KEYS.every((key) => adjust[key] === 0)) return null;
  const { sharpen, grain, pixelate, split, glitch, vhs } = adjust;
  return {
    style: { sharpen, grain, pixelate, split, glitch, vhs },
    grade,
    project: { width: doc.width, height: doc.height },
    scale: ctx.canvas.width / doc.width,
    time: frame / doc.fps,
  };
}

// A picture that is graded or stylised: painted on a layer of its own, the size of the frame, handed to the
// graphics card, and the finished frame-sized picture drawn onto the frame with the clip's own opacity and blend.
// The effects work on the picture as it sits in the frame, so a grain speck or a pixelated block is the same size
// however the clip is scaled. False when there is no layer to paint on: the caller then draws the picture plain.
// Where there is a layer but no graphics card, the picture is drawn from the layer as it is.
function drawFinished(ctx: Ctx2D, pass: FinishPass, paint: (target: Ctx2D) => void, options: DrawOptions): boolean {
  const { width, height } = ctx.canvas;
  const layer = (options.makeLayer ?? defaultLayer)(width, height, "finish");
  if (!layer) return false;
  const finisher = options.finish === undefined ? (sharedFinisher ??= createFinisher()) : options.finish;
  const m = ctx.getTransform();
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, width, height);
  layer.setTransform(m);
  paint(layer);
  layer.restore();
  const finished = finisher?.(layer.canvas, width, height, pass) ?? layer.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(finished, 0, 0);
  ctx.setTransform(m);
  return true;
}

// A picture cut to its mask: painted whole on a layer of its own, the mask's shape then keeps (or, inverted, takes
// out) its part of that layer, and the layer joins the frame. box: what the mask's shares are shares of, in the
// clip's own pixels. The mask's soft edge is a canvas blur on the shape. False when there is no layer to paint on:
// the caller then draws the picture unmasked.
function drawMasked(ctx: Ctx2D, mask: Mask, box: LocalRect, paint: (target: Ctx2D) => void, options: DrawOptions): boolean {
  const { width, height } = ctx.canvas;
  const layer = (options.makeLayer ?? defaultLayer)(width, height, "mask");
  if (!layer) return false;
  const m = ctx.getTransform();
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, width, height);
  layer.setTransform(m);
  paint(layer);
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const mw = mask.width * w;
  const mh = mask.height * h;
  const cx = box.left + mask.x * w;
  const cy = box.top + mask.y * h;
  const blur = mask.feather * (Math.min(mw, mh) / 2) * Math.hypot(m.a, m.b);
  layer.globalCompositeOperation = mask.invert ? "destination-out" : "destination-in";
  if (blur > 0.01) layer.filter = `blur(${Number(blur.toFixed(2))}px)`;
  layer.fillStyle = "#000000";
  layer.beginPath();
  if (mask.shape === "ellipse") layer.ellipse(cx, cy, mw / 2, mh / 2, 0, 0, Math.PI * 2);
  else layer.rect(cx - mw / 2, cy - mh / 2, mw, mh);
  layer.fill();
  layer.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.setTransform(m);
  return true;
}

// An adjustment layer: the frame as drawn so far is copied to a layer, and drawn back over itself with the layer's
// colour changes, grade and stylised effects, as much of it as the layer's opacity. A layer that changes nothing, or
// is fully see-through, draws nothing. Without a canvas to copy the frame to, it is left out.
function drawAdjustment(ctx: Ctx2D, doc: TimelineDoc, clip: AdjustmentClip, frame: number, options: DrawOptions): void {
  const amount = effectiveTransform(clip, frame).opacity;
  if (amount <= 0) return;
  const adjust = adjustAt(clip, frame);
  const toned = TONE_KEYS.some((key) => adjust[key] !== 0);
  const pass = finishOf(ctx, doc, clip, adjust, frame);
  if (!toned && !pass) return;
  const { width, height } = ctx.canvas;
  const under = (options.makeLayer ?? defaultLayer)(width, height, "under");
  if (!under) return;
  under.save();
  under.setTransform(1, 0, 0, 1, 0, 0);
  under.clearRect(0, 0, width, height);
  under.drawImage(ctx.canvas, 0, 0);
  under.restore();
  // The copy goes back pixel for pixel: it is already the size of the canvas, so nothing is scaled and nothing softens.
  const paint = (target: Ctx2D) => {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(under.canvas, 0, 0);
    target.restore();
  };
  const whole = { left: 0, top: 0, right: doc.width, bottom: doc.height };
  const tone = (target: Ctx2D) => (toned ? drawAdjusted(target, adjust, whole, false, paint, options) : paint(target));
  const finished = (target: Ctx2D) => {
    if (!pass || !drawFinished(target, pass, tone, options)) tone(target);
  };
  ctx.save();
  ctx.globalAlpha = amount;
  // With a mask, only that part of the frame takes the change.
  if (!clip.mask || !drawMasked(ctx, clip.mask, whole, finished, options)) finished(ctx);
  ctx.restore();
}

// A second kept canvas, the size of the picture being keyed, apart from the frame's layer: a keyed picture is what
// that layer is then painted from.
let sharedKeyLayer: { width: number; height: number; ctx: Ctx2D } | null = null;

function defaultKeyLayer(width: number, height: number): Ctx2D | null {
  if (sharedKeyLayer && sharedKeyLayer.width === width && sharedKeyLayer.height === height) return sharedKeyLayer.ctx;
  // Read back every frame, so it is kept where reading is cheap.
  const ctx = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  sharedKeyLayer = ctx ? { width, height, ctx } : null;
  return ctx;
}

// The picture with its key colour taken out: drawn at its own size on a canvas of its own, its pixels read, keyed and
// put back. Everything after (the crop, the flip, the colours) then draws from that canvas. The picture itself where
// there is no canvas to key on.
function keyed(source: ResolvedSource, key: ChromaKey, options: DrawOptions): ResolvedSource {
  const width = Math.max(1, Math.round(source.width));
  const height = Math.max(1, Math.round(source.height));
  const layer = (options.makeKeyLayer ?? defaultKeyLayer)(width, height);
  if (!layer) return source;
  layer.clearRect(0, 0, width, height);
  layer.drawImage(source.image, 0, 0, width, height);
  const pixels = layer.getImageData(0, 0, width, height);
  keyOut(pixels.data, key);
  layer.putImageData(pixels, 0, 0);
  return { image: layer.canvas, width, height };
}

function drawMedia(ctx: Ctx2D, doc: TimelineDoc, clip: MediaClip & { type: "video" | "image" }, frame: number, options: DrawOptions): void {
  const raw = options.resolveSource?.(clip, frame) ?? null;
  const source = hasPicture(raw) && clip.chroma ? keyed(raw, clip.chroma, options) : raw;
  const size = mediaSize(doc, clip, source);
  const crop = clip.transform.crop;
  const k = cropRect(centred(size), crop);
  if (hasPicture(source)) {
    const rounding = clip.rounding ?? 0;
    if (rounding > 0) {
      // Rounded corners: everything this clip draws from here on stays inside the rounded box of what is shown.
      roundedBox(ctx, k, (rounding * Math.min(k.right - k.left, k.bottom - k.top)) / 2);
      ctx.clip();
    }
    if (clip.type === "video" && clip.steady) {
      // Steadied: the picture is moved back by this frame's share of the camera's shake, and drawn a little larger
      // so that never shows an edge. What is shown stays where it is: the move happens inside the picture's own box.
      const move = moveAt(clip.steady, clip.in + (frame - clip.start) * clip.speed);
      ctx.beginPath();
      ctx.rect(k.left, k.top, k.right - k.left, k.bottom - k.top);
      ctx.clip();
      ctx.translate(move.dx * size.width, move.dy * size.height);
      ctx.scale(clip.steady.zoom, clip.steady.zoom);
    }
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
    const adjust = adjustAt(clip, frame);
    const toned = TONE_KEYS.some((key) => adjust[key] !== 0);
    // A keyed picture has see-through parts, as an image may.
    const tone = (target: Ctx2D) => (toned ? drawAdjusted(target, adjust, k, clip.type === "image" || !!clip.chroma, paint, options) : paint(target));
    const pass = finishOf(ctx, doc, clip, adjust, frame);
    const finished = (target: Ctx2D) => {
      if (!pass || !drawFinished(target, pass, tone, options)) tone(target);
    };
    if (!clip.mask || !drawMasked(ctx, clip.mask, k, finished, options)) finished(ctx);
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

// A whip's smear is spread in steps that each double its copies, until they sit at most SMEAR_GAP canvas pixels apart,
// in at most SMEAR_STEPS_MAX steps: 128 copies. A longer smear has its copies further apart, but each is then a 128th of
// the picture, too faint to make out.
const SMEAR_GAP = 2;
const SMEAR_STEPS_MAX = 7;

// Set while a smeared clip is painted: a whip inside a nest that is itself whipping is smeared with the nest, since the
// two would need the same layers.
let smearing = false;

// A whip's motion blur, as a camera's shutter makes one: the clip is drawn once on a layer of its own, then spread
// evenly along its move, as if drawn at every place it passes while the frame is exposed. Each step adds the layer to
// itself moved half a step either way, each copy at half strength, so k steps make 2^k evenly weighted copies from 4k
// quick draws, close enough together to read as one smear. Adding the copies, not stacking them, keeps what is
// see-through right: the smear fades out at its ends as a real one does, and the whole is exactly as solid as the
// clip. It then joins the frame with the clip's own opacity and blend. The preview, a saved frame and the export all
// draw it here, so they match. False when there is no layer, or the smear is under a canvas pixel: the caller then
// draws the clip as it is.
function drawSmeared(ctx: Ctx2D, smear: Smear, alpha: number, composite: GlobalCompositeOperation | null, paint: (target: Ctx2D) => void, options: DrawOptions): boolean {
  if (smearing) return false;
  const m = ctx.getTransform();
  // In canvas pixels. A whip moves straight across or straight up and down, and a frame is only ever scaled onto its canvas.
  const across = Math.abs(m.a * smear.dx + m.c * smear.dy);
  const down = Math.abs(m.b * smear.dx + m.d * smear.dy);
  const horizontal = across >= down;
  const length = horizontal ? across : down;
  if (length < 1) return false;
  const { width, height } = ctx.canvas;
  const make = options.makeLayer ?? defaultLayer;
  const first = make(width, height, "motion");
  const second = first && make(width, height, "motion-spread");
  if (!first || !second) return false;
  first.save();
  first.setTransform(1, 0, 0, 1, 0, 0);
  first.clearRect(0, 0, width, height);
  first.setTransform(m);
  smearing = true;
  try {
    paint(first);
  } finally {
    smearing = false;
    first.restore();
  }
  const steps = Math.min(SMEAR_STEPS_MAX, Math.max(1, Math.ceil(Math.log2(length / SMEAR_GAP))));
  const gap = length / 2 ** steps;
  let from = first;
  let to = second;
  for (let i = 0; i < steps; i++) {
    spreadStep(from, to, (gap * 2 ** i) / 2, horizontal, width, height);
    [from, to] = [to, from];
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  if (composite) ctx.globalCompositeOperation = composite;
  ctx.drawImage(from.canvas, 0, 0);
  ctx.restore();
  return true;
}

// One step of a smear: the picture on `from` added to itself `half` canvas pixels either way along the move, each copy
// at half strength, onto `to`. Where a moved copy leaves a strip bare at the canvas's edge, that edge's own pixels are
// stretched across it, as if the picture went on past the frame: a clip that crosses the edge smears there as it does
// everywhere else, and does not fade into black.
function spreadStep(from: Ctx2D, to: Ctx2D, half: number, horizontal: boolean, width: number, height: number): void {
  const source = from.canvas;
  to.save();
  to.setTransform(1, 0, 0, 1, 0, 0);
  to.clearRect(0, 0, width, height);
  to.globalCompositeOperation = "lighter";
  to.globalAlpha = 0.5;
  if (horizontal) {
    to.drawImage(source, -half, 0);
    to.drawImage(source, width - 1, 0, 1, height, width - half, 0, half, height);
    to.drawImage(source, half, 0);
    to.drawImage(source, 0, 0, 1, height, 0, 0, half, height);
  } else {
    to.drawImage(source, 0, -half);
    to.drawImage(source, 0, height - 1, width, 1, 0, height - half, width, half);
    to.drawImage(source, 0, half);
    to.drawImage(source, 0, 0, width, 1, 0, 0, width, half);
  }
  to.restore();
}

// One clip at a transform and alpha, smeared along its move when it is whipping.
function drawClip(
  ctx: Ctx2D,
  doc: TimelineDoc,
  clip: Clip,
  frame: number,
  draw: { t: Transform; alpha: number; text: TextLook; smear?: Smear | null },
  options: DrawOptions,
  resolveFont: (family: string) => string,
): void {
  const composite = clip.type === "placeholder" || clip.type === "adjustment" ? null : compositeOf(clip.blend);
  // On its own layer the clip is drawn whole and plain: the layer takes its opacity and blend as it joins the frame.
  const own = (target: Ctx2D) => placeClip(target, doc, clip, frame, draw, options, resolveFont);
  if (draw.smear && drawSmeared(ctx, draw.smear, draw.alpha, composite, own, options)) return;
  ctx.save();
  ctx.globalAlpha = draw.alpha;
  if (composite) ctx.globalCompositeOperation = composite;
  placeClip(ctx, doc, clip, frame, draw, options, resolveFont);
  ctx.restore();
}

// A clip placed, turned and scaled to its transform, and drawn. The caller saves and restores around it.
function placeClip(
  ctx: Ctx2D,
  doc: TimelineDoc,
  clip: Clip,
  frame: number,
  draw: { t: Transform; text: TextLook },
  options: DrawOptions,
  resolveFont: (family: string) => string,
): void {
  const { t } = draw;
  // A nest's clips are drawn where they sit on the frame, before the nest itself is placed.
  const frameTransform = clip.type === "nest" ? ctx.getTransform() : null;
  // A keyed crop is part of the transform at this frame: the clip is drawn as if it were its own.
  const shown = t.crop === clip.transform.crop ? clip : ({ ...clip, transform: { ...clip.transform, crop: t.crop } } as Clip);
  ctx.translate(t.x * doc.width, t.y * doc.height);
  ctx.rotate((t.rotation * Math.PI) / 180);
  // A stretch widens text glyphs too. Wrapping happens in local units, so it does not change.
  ctx.scale(t.scale * stretchOf(t), t.scale);
  if (shown.type === "text") drawText(ctx, doc, shown, resolveFont, draw.text);
  else if (shown.type === "shape") drawShape(ctx, shown);
  else if (shown.type === "video" || shown.type === "image") drawMedia(ctx, doc, shown as MediaClip & { type: "video" | "image" }, frame, options);
  else if (shown.type === "nest" && frameTransform) drawNest(ctx, doc, shown, frame, options, frameTransform);
}

// A nest: its tracks are drawn together, at the frame of its own timeline that shows now, on a layer of their own
// with nothing behind them; that layer is then the nest's picture, and is placed, faded, coloured and masked as any
// picture is. Its clips' media is asked for under their nested names (nestTracks). With no layer to draw on, the
// nest draws nothing.
function drawNest(ctx: Ctx2D, doc: TimelineDoc, nest: NestClip, frame: number, options: DrawOptions, frameTransform: DOMMatrix): void {
  const { width, height } = ctx.canvas;
  const layer = (options.makeLayer ?? defaultLayer)(width, height, "nest");
  if (!layer) return;
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, width, height);
  layer.setTransform(frameTransform);
  layer.globalAlpha = 1;
  layer.globalCompositeOperation = "source-over";
  const inner: TimelineDoc = { ...doc, tracks: nestTracks(nest), captions: undefined };
  drawTracks(layer, inner, nestFrame(nest, frame), { ...options, hideClipId: undefined, hideCue: undefined }, options.resolveFont ?? defaultResolveFont);
  layer.restore();
  const picture: ResolvedSource = { image: layer.canvas as CanvasImageSource, width, height };
  // From here on it is a picture like any other: one that fills the frame.
  const asPicture = { ...nest, type: "image", assetId: nest.id, in: 0, speed: 1, volume: 0 } as unknown as MediaClip & { type: "image" };
  drawMedia(ctx, doc, asPicture, frame, { ...options, resolveSource: () => picture });
}

// Draws in project pixels and never reads the canvas size: a caller that wants a smaller canvas scales the context first.
export function drawFrame(ctx: Ctx2D, doc: TimelineDoc, frame: number, options: DrawOptions = {}): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, doc.width, doc.height);
  drawTracks(ctx, doc, frame, options, options.resolveFont ?? defaultResolveFont);
}

// Everything a project's tracks draw at a frame, over whatever the context holds: the frame's black for a project,
// nothing for a nest's own tracks.
function drawTracks(ctx: Ctx2D, doc: TimelineDoc, frame: number, options: DrawOptions, resolveFont: (family: string) => string): void {
  // Captions sit at their track's place in the stack: after the clips on tracks before it, before those after it.
  const captionAt = captionsShow(doc) ? doc.tracks.findIndex((t) => t.kind === "caption") : -1;
  let captionsDrawn = captionAt < 0;
  // An adjustment layer is worked in at its own track's place: after everything on the tracks before it.
  const layers = adjustmentsAt(doc, frame);
  let nextLayer = 0;
  const place = (track: Track) => doc.tracks.indexOf(track);
  const reach = (trackAt: number) => {
    if (!captionsDrawn && trackAt > captionAt) {
      drawCaptions(ctx, doc, frame, resolveFont, options.hideCue);
      captionsDrawn = true;
    }
  };
  const adjustUpTo = (trackAt: number) => {
    while (nextLayer < layers.length && place(layers[nextLayer].track) < trackAt) {
      const layer = layers[nextLayer++];
      reach(place(layer.track));
      if (layer.clip.id !== options.hideClipId) drawAdjustment(ctx, doc, layer.clip, frame, options);
    }
  };
  for (const { track, clip, tail } of drawnClips(doc, frame)) {
    if (layers.length > 0) adjustUpTo(place(track));
    if (!captionsDrawn && doc.tracks.indexOf(track) > captionAt) {
      drawCaptions(ctx, doc, frame, resolveFont, options.hideCue);
      captionsDrawn = true;
    }
    if (clip.id === options.hideClipId) continue;
    if (tail) {
      // Under a crossfade the outgoing clip plays on as it is: its own out-transition belongs to the cut, not the blend.
      const t = effectiveTransform(clip, frame);
      drawClip(ctx, doc, clip, frame, { t, alpha: t.opacity, text: PLAIN_TEXT }, options, resolveFont);
      continue;
    }
    const look = clipLook(asDrawn(track, clip), frame, doc);
    const t = look.transform;
    drawClip(ctx, doc, clip, frame, { t, alpha: t.opacity * look.alpha, text: look, smear: look.smear }, options, resolveFont);
    if (look.dip && look.dip.alpha > 0) {
      ctx.save();
      ctx.globalAlpha = look.dip.alpha;
      ctx.fillStyle = look.dip.color;
      ctx.fillRect(0, 0, doc.width, doc.height);
      ctx.restore();
    }
  }
  if (layers.length > 0) adjustUpTo(Infinity);
  if (!captionsDrawn) drawCaptions(ctx, doc, frame, resolveFont, options.hideCue);
}
