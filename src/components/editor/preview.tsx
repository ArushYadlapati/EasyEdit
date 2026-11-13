"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { boardLayout, boardScale, centreOf, scrollFor, type BoardLayout, type Size } from "@/lib/editor/board";
import { canvasItems, createPreviewSurface, viewOf, visibleBox } from "@/lib/editor/canvas-geometry";
import type { Sizer } from "@/lib/editor/clip-box";
import { makeFontResolver } from "@/lib/editor/fonts";
import { mediaWants, upcomingAssetIds } from "@/lib/editor/media-plan";
import { previewSize } from "@/lib/editor/preview-size";
import type { BoardZoom } from "@/lib/editor/settings";
import { viewDoc } from "@/lib/editor/store";
import { drawFrame } from "@/lib/render/compositor";
import { SAFE_ZONES } from "@/lib/render/safe-zones";
import type { TimelineDoc } from "@/lib/timeline";
import { CanvasOverlay } from "./canvas-overlay";
import { useEditor, useEditorStore, useSettings } from "./context";
import { useMedia, type MediaServices } from "./media/media-context";
import { createMediaPool, upcomingWants, type PoolDeps } from "./media/media-pool";
import { Transport } from "./transport";
import { usePlayback } from "./use-playback";
import { BoardScaleContext } from "./zoom-menu";

// What the board last showed, so a zoom change, or a pane resize at a fixed zoom, can keep the same middle.
type Shown = { zoom: BoardZoom; layout: BoardLayout; pane: Size; scroll: { left: number; top: number } };

// The picture, drawn by the same compositor export uses, with the transport underneath. The canvas
// is drawn from a store subscription, not from React state, so playing re-renders nothing here.
// A frame the playback loop moves to is drawn in that same animation frame, in step with the
// timecode and the timeline's playhead; every other change waits for the next one. Each draw first makes the
// media pool's video and audio elements match the frame, readying those of the clips that start soon, then draws
// from them.
// The frame sits on a board: in Fill it fits the pane, and at a percentage it keeps its size and the board scrolls.
// The canvas keeps its backing size at every zoom and CSS scales it, so a zoom or a scroll never redraws.
// Over the board lies the overlay where clips are pressed and outlined. It learns what is drawn, and where, from
// the surface, which is told after every draw and every change to the board's layout or scroll.
export function Preview() {
  const drawNow = useRef<(() => void) | null>(null);
  const redraw = useRef<(() => void) | null>(null);
  usePlayback(useCallback(() => drawNow.current?.(), []));
  const store = useEditorStore();
  const media = useMedia();
  const pool = useMemo(() => createMediaPool(poolDeps(media)), [media]);
  const playing = useEditor((s) => s.playing);
  const rate = useEditor((s) => s.rate);
  const width = useEditor((s) => viewDoc(s).width);
  const height = useEditor((s) => viewDoc(s).height);
  const format = useEditor((s) => viewDoc(s).format);
  const showSafeZones = useEditor((s) => s.showSafeZones);
  const boardZoom = useSettings((s) => s.boardZoom);
  const paneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [surface] = useState(() => createPreviewSurface());
  const [pane, setPane] = useState<Size>({ width: 0, height: 0 });

  const backing = previewSize({ width, height });
  const layout = useMemo(() => {
    const doc = { width, height };
    return boardLayout(boardScale(boardZoom, doc, pane), doc, pane);
  }, [boardZoom, width, height, pane]);
  const zone = SAFE_ZONES[format];

  // The pane's inside, before the first paint and on every resize.
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setPane((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A zoom change keeps the point at the pane's middle there, and so does a pane resize at a fixed zoom (the browser
  // would keep the scroll, and the view would drift). The scroll it starts from is the one shown before the change,
  // since the browser may already have cut it down to a smaller content. Until the pane was measured, the frame's
  // middle is put there.
  const shown = useRef<Shown | null>(null);
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const before = shown.current;
    const paneChanged = before !== null && (before.pane.width !== pane.width || before.pane.height !== pane.height);
    if (before && (before.zoom !== boardZoom || (boardZoom !== "fill" && paneChanged))) {
      const measured = before.pane.width > 0 && before.pane.height > 0 && before.layout.k > 0;
      const middle = measured ? centreOf(before.layout, before.pane, before.scroll) : { x: width / 2, y: height / 2 };
      const next = scrollFor(middle, layout, pane);
      el.scrollLeft = next.left;
      el.scrollTop = next.top;
    }
    shown.current = { zoom: boardZoom, layout, pane, scroll: { left: el.scrollLeft, top: el.scrollTop } };
  }, [boardZoom, layout, pane, width, height]);

  // The frame moved on screen: a new pane size or zoom (after the scroll that keeps the middle), or a scroll of the
  // board, told at most once per animation frame.
  useLayoutEffect(() => surface.changed(), [surface, layout]);
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        surface.changed();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [surface]);

  // A play, a pause or a new rate is drawn, so the media starts, stops or changes speed. This effect comes after
  // usePlayback's, and asks for its frame anew, so on a play the loop's animation frame comes first and a frame it
  // moves to is drawn once.
  const shownPlay = useRef({ playing, rate });
  useEffect(() => {
    if (shownPlay.current.playing === playing && shownPlay.current.rate === rate) return; // the first draw has them
    shownPlay.current = { playing, rate };
    redraw.current?.();
  }, [playing, rate]);

  useEffect(() => () => pool.dispose(), [pool]);

  // Draws now, then again whenever the shown document, the playhead, the loaded fonts, the library or the
  // media change, at most once per animation frame. A new backing size clears the canvas, so it starts over then.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resolveFont = makeFontResolver(cachedCssVar());
    const requested = new Set<string>();
    let raf = 0;
    let disposed = false;

    const draw = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const s = store.getState();
      const doc = viewDoc(s);
      pool.preload(upcomingAssetIds(doc, s.playhead));
      pool.sync(mediaWants(doc, s.playhead, { playing: s.playing, rate: s.rate }), upcomingWants(doc, s.playhead));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { scale } = previewSize(doc);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawFrame(ctx, doc, s.playhead, { resolveFont, resolveSource: pool.resolveSource, placeholderLabel: pool.label });
      surface.changed();
    };
    // A frame asked for is skipped if a draw came first: the playback loop draws in its own animation frame.
    const schedule = () => {
      if (disposed || raf !== 0) return;
      const id = requestAnimationFrame(() => {
        if (raf === id) draw();
      });
      raf = id;
    };
    // Asks the browser for every face the text uses and draws again once each has loaded, so text
    // never stays in a fallback face.
    const loadFonts = (doc: TimelineDoc) => {
      if (!("fonts" in document)) return;
      for (const font of textFonts(doc, resolveFont)) {
        if (requested.has(font)) continue;
        requested.add(font);
        document.fonts.load(font).then(schedule, schedule);
      }
    };

    // What is drawn now, measured as the draw measures it: each picture at the size the pool gives for the
    // playhead (or none, the frame-sized placeholder), and text in its font on this canvas's context.
    const detach = surface.attach({
      items() {
        const ctx = canvas.getContext("2d");
        if (!ctx) return [];
        const s = store.getState();
        const sizer: Sizer = {
          source(clip) {
            const source = pool.resolveSource(clip, s.playhead);
            return source ? { width: source.width, height: source.height } : null;
          },
          measure(clip, text) {
            ctx.save();
            ctx.font = `${clip.style.fontWeight} ${clip.style.fontSize}px ${resolveFont(clip.style.fontFamily)}`;
            const width = ctx.measureText(text).width;
            ctx.restore();
            return width;
          },
        };
        return canvasItems(viewDoc(s), s.playhead, sizer);
      },
      view() {
        const box = canvas.getBoundingClientRect();
        return box.width > 0 ? viewOf(box, viewDoc(store.getState()).width) : null;
      },
      visible() {
        const el = paneRef.current;
        const content = contentRef.current;
        if (!el || !content) return null;
        const box = el.getBoundingClientRect();
        return visibleBox({ left: box.left, top: box.top, width: el.clientWidth, height: el.clientHeight }, content.getBoundingClientRect());
      },
    });

    const unsubscribe = store.subscribe((s, prev) => {
      const doc = viewDoc(s);
      const docChanged = doc !== viewDoc(prev);
      if (docChanged) loadFonts(doc);
      // A pause stops the media at once, not in the next animation frame: usePlayback pauses when the tab is
      // hidden, and a hidden tab runs none, so the media would go on sounding past the clip until it is shown.
      if (prev.playing && !s.playing) {
        pool.sync(mediaWants(doc, s.playhead, { playing: false, rate: s.rate }), upcomingWants(doc, s.playhead));
      }
      if (docChanged || s.playhead !== prev.playhead) schedule();
    });
    const unsubscribeLibrary = media.library.subscribe((s, prev) => {
      if (s.assets !== prev.assets || s.loaded !== prev.loaded) schedule();
    });
    const stopListening = pool.onChange(schedule);
    loadFonts(viewDoc(store.getState()));
    draw();
    drawNow.current = draw;
    redraw.current = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      schedule();
    };
    return () => {
      disposed = true;
      detach();
      drawNow.current = null;
      redraw.current = null;
      if (raf) cancelAnimationFrame(raf);
      unsubscribe();
      unsubscribeLibrary();
      stopListening();
    };
  }, [store, media, pool, surface, backing.width, backing.height]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {/* In Fill nothing scrolls, so a scrollbar can never shrink the pane and start a refit. */}
        <div
          ref={paneRef}
          data-board
          className={cx("absolute inset-0 overscroll-contain", boardZoom === "fill" ? "overflow-hidden" : "overflow-auto")}
          onScroll={(event) => {
            if (shown.current) shown.current.scroll = { left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          }}
        >
          <div ref={contentRef} className="relative" style={{ width: layout.content.width, height: layout.content.height }}>
            {/* Placed by its offset, never by flex centring, which would push an overflowing frame past where scrolling
                reaches. The edge is an outline, outside the box, so the canvas and the safe-zone box cover exactly the
                picture. */}
            <div
              data-frame
              className="absolute outline outline-ed-line"
              style={{ left: layout.offset.x, top: layout.offset.y, width: layout.frame.width, height: layout.frame.height }}
            >
              <canvas ref={canvasRef} role="img" aria-label="Preview" width={backing.width} height={backing.height} className="block size-full" />
              {showSafeZones && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute border border-dashed border-ed-faint"
                  style={{ top: `${zone.top * 100}%`, right: `${zone.right * 100}%`, bottom: `${zone.bottom * 100}%`, left: `${zone.left * 100}%` }}
                >
                  <span className="absolute top-1 left-1.5 text-[11px] leading-4 text-ed-muted">{zone.label}</span>
                </div>
              )}
            </div>
            {/* The overlay fills the content box, so it covers the frame and its margin and is never smaller than the
                pane; its corner is the content's, which visible() measures from. */}
            <CanvasOverlay surface={surface} pane={paneRef} />
          </div>
        </div>
      </div>
      <BoardScaleContext value={layout.k}>
        <Transport />
      </BoardScaleContext>
    </div>
  );
}

// What the pool needs from this page: the library, elements that are never added to the page, and the browser's
// image decoder.
function poolDeps(media: MediaServices): PoolDeps {
  return {
    files: media.files,
    asset: (assetId) => media.library.getState().assets[assetId],
    loaded: () => media.library.getState().loaded,
    makeVideo: () => {
      const video = document.createElement("video");
      video.playsInline = true;
      video.preload = "auto";
      return video;
    },
    makeAudio: () => {
      const audio = document.createElement("audio");
      audio.preload = "auto";
      return audio;
    },
    decodeImage,
    objectUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  };
}

// Decodes an image, made smaller when its longer side is over maxSide.
async function decodeImage(blob: Blob, maxSide: number): Promise<{ image: ImageBitmap; width: number; height: number }> {
  const full = await createImageBitmap(blob);
  const scale = maxSide / Math.max(full.width, full.height);
  if (scale >= 1) return { image: full, width: full.width, height: full.height };
  const width = Math.max(1, Math.round(full.width * scale));
  const height = Math.max(1, Math.round(full.height * scale));
  try {
    return { image: await createImageBitmap(full, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" }), width, height };
  } finally {
    full.close();
  }
}

// Reads CSS variables from the document element. The app's font variables never change once set, so a
// value is read once.
function cachedCssVar(): (name: string) => string {
  const cache = new Map<string, string>();
  return (name) => {
    const known = cache.get(name);
    if (known !== undefined) return known;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    if (value.trim()) cache.set(name, value);
    return value;
  };
}

// Each distinct weight and family the text clips use, as a CSS font for document.fonts.load. The size
// does not choose the face, so one size stands for all.
function textFonts(doc: TimelineDoc, resolveFont: (family: string) => string): Set<string> {
  const fonts = new Set<string>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.type === "text") fonts.add(`${clip.style.fontWeight} 16px ${resolveFont(clip.style.fontFamily)}`);
    }
  }
  return fonts;
}
