"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { cx } from "@/components/ui/cx";
import { findCue, type CueKey } from "@/lib/captions/cues";
import { toOverlay, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { makeFontResolver } from "@/lib/editor/fonts";
import { viewDoc } from "@/lib/editor/store";
import { captionStyleOf } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";
import { useCaptionLine } from "./captions/use-caption-line";

// Type smaller than this is hard to read and to place a caret in, so the box never shows less.
const MIN_FONT_PX = 13;
// The box is never narrower than this, so a short line still has room for what is typed after it.
const MIN_WIDTH_PX = 160;

type Place = { left: number; top: number; width: number; fontSize: number; fontFamily: string; fontWeight: number; color: string; uppercase: boolean };

const px = (v: number) => Math.round(v * 100) / 100;

// The box a caption line is typed in on the preview, laid over the drawn line (which the preview leaves out meanwhile)
// in the captions' font, size, weight and colour. A caption line is one line: Enter (with Shift too) or leaving the box
// saves, Escape puts the line back; either way it closes, and a key gives focus back to what had it. What is typed is a
// held edit (useCaptionLine), so a pause saves it too. It lives in the preview's overlay, which leaves presses inside
// it alone.
export function CanvasCaptionEditor({ cueKey, surface }: { cueKey: CueKey; surface: PreviewSurface }): ReactNode {
  const store = useEditorStore();
  const ref = useRef<HTMLInputElement>(null);
  const before = useRef<Element | null>(null);
  const closed = useRef(false);
  const [placed] = useState(() => createStore<{ place: Place | null }>(() => ({ place: null })));
  const place = useStore(placed, (s) => s.place);
  const shown = useEditor((s) => findCue(s.doc, cueKey)?.text ?? "");
  const line = useCaptionLine(store, cueKey, shown);

  // Over the line's block as the board draws it, worked out whenever the preview draws or its board moves. A line not
  // drawn just now (the playhead moved off it) keeps the last place.
  useLayoutEffect(() => {
    const resolveFont = makeFontResolver((name) => getComputedStyle(document.documentElement).getPropertyValue(name));
    const refresh = () => {
      const overlay = ref.current?.parentElement;
      const view = surface.view();
      const item = surface.items().find((i) => i.type === "caption" && i.cue !== undefined && sameKey(i.cue, cueKey));
      if (!overlay || !view || !item) return;
      const style = captionStyleOf(viewDoc(store.getState()));
      const at = toOverlay(view, overlay.getBoundingClientRect(), item.center);
      const next: Place = {
        left: px(at.x),
        top: px(at.y),
        width: px(Math.max(MIN_WIDTH_PX, (item.rect.right - item.rect.left) * view.k)),
        fontSize: px(Math.max(MIN_FONT_PX, style.fontSize * view.k)),
        fontFamily: resolveFont(style.fontFamily),
        fontWeight: style.fontWeight,
        color: style.color,
        uppercase: style.uppercase,
      };
      if (JSON.stringify(placed.getState().place) !== JSON.stringify(next)) placed.setState({ place: next });
    };
    refresh();
    return surface.onChange(refresh);
  }, [surface, store, cueKey, placed]);

  // Opens with all of the line selected, ready to be typed over, remembering what had focus.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el) before.current = document.activeElement;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  function close(byKey: boolean) {
    if (closed.current) return;
    closed.current = true;
    const back = before.current;
    if (byKey && back instanceof HTMLElement && back.isConnected) back.focus();
    store.getState().setCaptionEdit(null);
  }

  return (
    <input
      ref={ref}
      type="text"
      data-canvas-text-editor
      data-caption-editor
      aria-label="Edit caption"
      spellCheck
      autoComplete="off"
      value={line.value}
      onChange={(event) => line.change(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          line.save();
          close(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          line.cancel();
          close(true);
        }
      }}
      onBlur={() => {
        if (closed.current) return;
        line.save();
        // Leaving the window is not a click away: what was typed is saved, and the box stays open for the return.
        if (!document.hasFocus()) return;
        close(false);
      }}
      className={cx(
        "absolute m-0 rounded-sm border-0 bg-black/40 px-1 py-0 text-center select-text",
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
              color: place.color,
              textTransform: place.uppercase ? "uppercase" : "none",
              transform: "translate(-50%, -50%)",
            }
          : undefined
      }
    />
  );
}

function sameKey(a: CueKey, b: CueKey): boolean {
  return a.clipId === b.clipId && a.captionId === b.captionId && a.index === b.index;
}

