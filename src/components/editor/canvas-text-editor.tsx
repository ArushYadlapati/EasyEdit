"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { cx } from "@/components/ui/cx";
import { toOverlay, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { makeFontResolver } from "@/lib/editor/fonts";
import { findClip, viewDoc } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import { LINE_HEIGHT, TEXT_BOX_WIDTH } from "@/lib/render/text-layout";
import { stretchOf } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";
import { useTextField } from "./use-field-gesture";

// Type smaller than this is hard to read and to place a caret in, so the box never shows less; it widens in step,
// so the lines still break where the drawn ones do.
const MIN_FONT_PX = 13;

// Where the box sits and how its text looks, in the overlay's pixels: its centre is the clip's centre, turned and
// stretched as the clip is.
type Place = {
  left: number;
  top: number;
  width: number;
  fontSize: number;
  turn: number;
  stretch: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
};

// Overlay pixels are kept to two decimals, so the same place always reads the same.
const px = (v: number) => Math.round(v * 100) / 100;

// The box a text clip is typed in on the preview, laid over the drawn text (which the preview leaves out meanwhile) in
// its font, size, weight, colour and alignment, turned and stretched with it, showing the whole text whatever its crop.
// It opens with the caret at the end. Escape, Cmd/Ctrl+Enter or leaving it saves one "text edit" and closes it; a plain
// Enter adds a line. Closed by a key, focus goes back to what had it before the box opened. It lives in the preview's
// overlay, which leaves presses inside it alone.
export function CanvasTextEditor({ clipId, surface }: { clipId: string; surface: PreviewSurface }): ReactNode {
  const store = useEditorStore();
  const ref = useRef<HTMLTextAreaElement>(null);
  const before = useRef<Element | null>(null);
  const closed = useRef(false);
  const [placed] = useState(() => createStore<{ place: Place | null }>(() => ({ place: null })));
  const place = useStore(placed, (s) => s.place);
  const shown = useEditor((s) => {
    const clip = findClip(viewDoc(s), clipId)?.clip;
    return clip?.type === "text" ? clip.text : "";
  });
  const text = useTextField(store, clipId, "text", shown, { escapeSaves: true, enterAddsLine: true });

  // Worked out whenever the preview draws or its board moves. Until the canvas is measured it is not placed, and a clip
  // that is not there keeps the last place.
  useLayoutEffect(() => {
    const resolveFont = makeFontResolver((name) => getComputedStyle(document.documentElement).getPropertyValue(name));
    const refresh = () => {
      const overlay = ref.current?.parentElement;
      const view = surface.view();
      const doc = viewDoc(store.getState());
      const clip = findClip(doc, clipId)?.clip;
      if (!overlay || !view || clip?.type !== "text") return;
      const t = clip.transform;
      const at = toOverlay(view, overlay.getBoundingClientRect(), { x: t.x * doc.width, y: t.y * doc.height });
      const fontSize = clip.style.fontSize * view.k * t.scale;
      const shownSize = Math.max(fontSize, MIN_FONT_PX);
      const next: Place = {
        left: px(at.x),
        top: px(at.y),
        width: px((TEXT_BOX_WIDTH * doc.width * view.k * t.scale * shownSize) / fontSize),
        fontSize: px(shownSize),
        turn: t.rotation,
        stretch: stretchOf(t),
        fontFamily: resolveFont(clip.style.fontFamily),
        fontWeight: clip.style.fontWeight,
        color: clip.style.color,
        align: clip.style.align,
      };
      if (JSON.stringify(placed.getState().place) !== JSON.stringify(next)) placed.setState({ place: next });
    };
    refresh();
    return surface.onChange(refresh);
  }, [surface, store, clipId, placed]);

  // Opens with the caret at the end, remembering what had focus.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el) before.current = document.activeElement;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // As tall as its lines, after every change.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  function close(byKey: boolean) {
    if (closed.current) return;
    closed.current = true;
    const back = before.current;
    if (byKey && back instanceof HTMLElement && back.isConnected) back.focus();
    store.getState().setTextEdit(null);
  }

  return (
    <textarea
      ref={ref}
      data-canvas-text-editor
      aria-label="Edit text"
      rows={1}
      maxLength={LIMITS.textClipChars}
      value={text.value}
      onChange={(event) => text.change(event.target.value)}
      onKeyDown={(event) => {
        if (text.onKeyDown(event)) close(true);
      }}
      onBlur={() => {
        if (closed.current) return;
        text.save();
        // Leaving the window is not a click away: what was typed is saved, and the box stays open for the return.
        if (!document.hasFocus()) return;
        close(false);
      }}
      className={cx(
        "absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre-wrap wrap-anywhere select-text",
        "outline outline-ed-accent",
        place === null && "opacity-0",
      )}
      style={
        place
          ? {
              left: place.left,
              top: place.top,
              width: place.width,
              fontSize: place.fontSize,
              fontFamily: place.fontFamily,
              fontWeight: place.fontWeight,
              lineHeight: LINE_HEIGHT,
              color: place.color,
              textAlign: place.align,
              transform: `translate(-50%, -50%) rotate(${place.turn}deg) scaleX(${place.stretch})`,
            }
          : undefined
      }
    />
  );
}
