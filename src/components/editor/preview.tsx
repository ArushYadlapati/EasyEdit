"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { boardLayout, boardScale, centreOf, pinchZoom, pointAt, scrollFor, scrollKeeping, type BoardLayout, type Point, type Size } from "@/lib/editor/board";
import { canvasItems, createPreviewSurface, viewOf, visibleBox } from "@/lib/editor/canvas-geometry";
import { frameTapOf } from "@/lib/editor/frame-tap";
import type { Sizer } from "@/lib/editor/clip-box";
import { mediaWants, upcomingAssetIds } from "@/lib/editor/media-plan";
import { previewSize } from "@/lib/editor/preview-size";
import { BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, clampPercent, type BoardZoom } from "@/lib/editor/settings";
import { viewDoc } from "@/lib/editor/store";
import { cueKeyText } from "@/lib/captions/cues";
import { probeRequests } from "@/lib/export/fonts";
import { drawFrame } from "@/lib/render/compositor";
import { SAFE_AREA_LABEL, safeAreaMargins } from "@/lib/render/safe-zones";
import { platformView } from "@/lib/editor/platform-views";
import type { TimelineDoc } from "@/lib/timeline";
import { CanvasOverlay } from "./canvas-overlay";
import { useEditor, useEditorStore, useSettings, useSettingsStore } from "./context";
import { decodeImage } from "./media/frame-decode";
import { useMedia, type MediaServices } from "./media/media-context";
import type { SoundBus } from "@/lib/audio/sound-bus";
import { createMediaPool, upcomingWants, type PoolDeps } from "./media/media-pool";
import { pageFontResolver } from "./page-fonts";
import { useBoardDrop } from "./use-board-drop";
import { useSoundBus } from "./sound-context";
import { usePlayback } from "./use-playback";
import { PlatformOverlay } from "./platform-overlay";

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
  const bus = useSoundBus();
  const pool = useMemo(() => createMediaPool(poolDeps(media, bus)), [media, bus]);
  const playing = useEditor((s) => s.playing);
  const rate = useEditor((s) => s.rate);
  const width = useEditor((s) => viewDoc(s).width);
  const height = useEditor((s) => viewDoc(s).height);
  const format = useEditor((s) => viewDoc(s).format);
  const safeAreas = useEditor((s) => viewDoc(s).safeAreas);
  const showSafeZones = useEditor((s) => s.showSafeZones);
  const viewAs = useEditor((s) => s.viewAs);
  const boardZoom = useSettings((s) => s.boardZoom);
  const settings = useSettingsStore();
  const paneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [surface] = useState(() => createPreviewSurface());
  const [pane, setPane] = useState<Size>({ width: 0, height: 0 });
  const drop = useBoardDrop();

  const backing = previewSize({ width, height });
  const layout = useMemo(() => {
    const doc = { width, height };
    return boardLayout(boardScale(boardZoom, doc, pane), doc, pane);
  }, [boardZoom, width, height, pane]);
  const zone = safeAreaMargins({ format, safeAreas });
  const platform = platformView({ width, height }, viewAs);

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
  // A pinch keeps the point under the fingers there instead (pinched: where, and the project point under it).
  const shown = useRef<Shown | null>(null);
  const pinched = useRef<{ at: Point; point: Point } | null>(null);
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const before = shown.current;
    const anchor = pinched.current;
    pinched.current = null;
    const paneChanged = before !== null && (before.pane.width !== pane.width || before.pane.height !== pane.height);
    if (before && (before.zoom !== boardZoom || (boardZoom !== "fill" && paneChanged))) {
      let next: { left: number; top: number };
      if (anchor && before.zoom !== boardZoom) next = scrollKeeping(anchor.point, anchor.at, layout, pane);
      else {
        const measured = before.pane.width > 0 && before.pane.height > 0 && before.layout.k > 0;
        const middle = measured ? centreOf(before.layout, before.pane, before.scroll) : { x: width / 2, y: height / 2 };
        next = scrollFor(middle, layout, pane);
      }
      el.scrollLeft = next.left;
      el.scrollTop = next.top;
    }
    shown.current = { zoom: boardZoom, layout, pane, scroll: { left: el.scrollLeft, top: el.scrollTop } };
  }, [boardZoom, layout, pane, width, height]);

  // A pinch on a trackpad (which the browser sends as the wheel with Ctrl held), or Ctrl/Cmd with the wheel, zooms the
  // board around the pointer and never the page. Safari sends its pinch as gesture events instead. React's wheel
  // listener is passive, so these are added by hand to be allowed to stop the browser's own zoom. The zoom is kept
  // unrounded between steps (wheelPercent), so many small steps add up.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    let wheelPercent: number | null = null;
    let gestureFrom = 0;
    const nowPercent = () => {
      const zoom = settings.getState().boardZoom;
      return zoom === "fill" ? store.getState().boardScale * 100 : zoom;
    };
    const zoomTo = (percent: number, clientX: number, clientY: number) => {
      wheelPercent = percent;
      const next = clampPercent(percent);
      if (next === settings.getState().boardZoom) return;
      const view = shown.current;
      if (view && view.layout.k > 0 && !pinched.current) {
        const box = el.getBoundingClientRect();
        const at = { x: clientX - box.left, y: clientY - box.top };
        pinched.current = { at, point: pointAt(view.layout, view.scroll, at) };
      }
      settings.getState().set({ boardZoom: next });
    };
    const startPercent = () => (wheelPercent !== null && clampPercent(wheelPercent) === settings.getState().boardZoom ? wheelPercent : nowPercent());
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * el.clientHeight : e.deltaY;
      zoomTo(pinchZoom(startPercent(), delta), e.clientX, e.clientY);
    };
    type Gesture = Event & { scale?: number; clientX?: number; clientY?: number };
    const onGestureStart = (e: Gesture) => {
      e.preventDefault();
      gestureFrom = startPercent();
    };
    const onGestureChange = (e: Gesture) => {
      e.preventDefault();
      if (typeof e.scale !== "number" || !(e.scale > 0)) return;
      const box = el.getBoundingClientRect();
      zoomTo(Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, gestureFrom * e.scale)), e.clientX ?? box.left + el.clientWidth / 2, e.clientY ?? box.top + el.clientHeight / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [settings, store]);

  // The frame moved on screen: a new pane size or zoom (after the scroll that keeps the middle), or a scroll of the
  // board, told at most once per animation frame.
  useLayoutEffect(() => surface.changed(), [surface, layout]);
  // The zoom menu lives in the control row, away from here: it reads the scale shown from the store.
  useLayoutEffect(() => store.getState().setBoardScale(layout.k), [store, layout.k]);
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

  // Draws now, then again whenever the shown document, the playhead, the text typed in place, the loaded fonts, the
  // library or the media change, at most once per animation frame. A new backing size clears the canvas, so it starts
  // over then.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resolveFont = pageFontResolver();
    const requested = new Set<string>(); // each font and text asked for, so a new character asks again
    let raf = 0;
    let disposed = false;

    // The scopes read this canvas after each draw.
    const tap = frameTapOf(store);
    tap.set(canvas);

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
      // Text or a caption line being typed in place is shown by its box, so it is not drawn under it as well.
      const hidden = {
        ...(s.textEditId !== null && { hideClipId: s.textEditId }),
        ...(s.captionEdit !== null && { hideCue: cueKeyText(s.captionEdit) }),
      };
      drawFrame(ctx, doc, s.playhead, { resolveFont, resolveSource: pool.resolveSource, placeholderLabel: pool.label, ...hidden });
      surface.changed();
      tap.drawn();
    };
    // A frame asked for is skipped if a draw came first: the playback loop draws in its own animation frame.
    const schedule = () => {
      if (disposed || raf !== 0) return;
      const id = requestAnimationFrame(() => {
        if (raf === id) draw();
      });
      raf = id;
    };
    // Asks the browser for every face the drawn text uses, with the characters it must draw (a face may hold only some
    // of them, such as the Ž of "Žofia"), and draws again once each has loaded, so text never stays in a fallback face.
    const loadFonts = (doc: TimelineDoc) => {
      if (!("fonts" in document)) return;
      for (const { font, text } of probeRequests(doc, resolveFont)) {
        const key = `${font}\n${text}`;
        if (requested.has(key)) continue;
        requested.add(key);
        document.fonts.load(font, text).then(schedule, schedule);
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
          measureFont(font, text) {
            ctx.save();
            ctx.font = font;
            const width = ctx.measureText(text).width;
            ctx.restore();
            return width;
          },
          resolveFont,
          measureSpan(clip, text, span) {
            ctx.save();
            ctx.font = `${(span?.italic ?? clip.style.italic) ? "italic " : ""}${span?.fontWeight ?? clip.style.fontWeight} ${clip.style.fontSize}px ${resolveFont(clip.style.fontFamily)}`;
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
      if (docChanged || s.playhead !== prev.playhead || s.textEditId !== prev.textEditId || s.captionEdit !== prev.captionEdit) schedule();
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
      {/* The board's wrapper takes drops on the frame and the margin around it, bubbling from the overlay, the handles
          and the text box; the transport is outside it, so a file dropped there goes to the library only. */}
      <div className="relative min-h-0 flex-1" data-drop={drop.over ? "over" : "idle"} {...drop.handlers}>
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
                reaches. The edge is an outline, outside the box, so the canvas and the safe area box cover exactly the
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
                  <span className="absolute top-1 left-1.5 text-[11px] leading-4 text-ed-muted">{SAFE_AREA_LABEL}</span>
                </div>
              )}
              {platform && <PlatformOverlay view={platform} frameShape={width / height} />}
            </div>
            {/* The overlay fills the content box, so it covers the frame and its margin and is never smaller than the
                pane; its corner is the content's, which visible() measures from. */}
            <CanvasOverlay surface={surface} pane={paneRef} />
          </div>
        </div>
        {/* What is dropped goes to the timeline at the playhead, not where it is let go, and the look says so. */}
        {drop.over && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center outline-2 -outline-offset-2 outline-ed-accent bg-ed-accent-weak/50">
            <p className="rounded-md bg-ed-panel px-3 py-1.5 text-[13px] text-ed-text">Drop to add at the playhead</p>
          </div>
        )}
      </div>
    </div>
  );
}

// What the pool needs from this page: the library, elements that are never added to the page, the browser's image
// decoder, and the editor's mix for the elements' sound when there is one.
function poolDeps(media: MediaServices, bus: SoundBus | null): PoolDeps {
  return {
    ...(bus && { line: (el) => bus.line(el) }),
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
