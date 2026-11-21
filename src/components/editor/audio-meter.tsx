"use client";

import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import {
  HOT_DB,
  METER_TICKS,
  RESTING_BAR,
  WARN_DB,
  advanceBar,
  barAtRest,
  dbLabel,
  meterFill,
  type Bar,
} from "@/lib/audio/meter";
import { useEditor, useEditorStore } from "./context";
import { useToMenuItems } from "./menu-items";
import { useSoundBus } from "./sound-context";

const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

// The bar's colours by height: green, then yellow from WARN_DB, then red from HOT_DB, each starting sharply so a
// level reads against the scale beside it.
const ZONES = `linear-gradient(to top, var(--ed-meter) 0 ${percent(meterFill(WARN_DB))}, var(--ed-warn) ${percent(meterFill(WARN_DB))} ${percent(
  meterFill(HOT_DB),
)}, var(--ed-danger) ${percent(meterFill(HOT_DB))} 100%)`;

const SIDES = ["L", "R"] as const;
const OVER_HINT = "Too loud here: the exported sound will distort. Click to clear.";

type Parts = { fill: HTMLDivElement | null; hold: HTMLDivElement | null; over: HTMLSpanElement | null };

// How loud the preview is right now, left and right, on a decibel scale: the strip at the right end of the timeline.
// Each bar jumps to the loudest moment and falls back, a thin line holds the recent peak, and the light on top stays
// red once a side has gone past full scale, where an export is cut flat, until it is clicked or playback starts again.
// It reads the editor's mix, so it shows what is heard: every clip's volume and fade and every muted track counted in.
// It repaints only while something is playing or still falling, by writing styles directly, so it never draws React
// again. Right-click hides it; View > Audio meter brings it back.
export function AudioMeter() {
  const bus = useSoundBus();
  const store = useEditorStore();
  const playing = useEditor((s) => s.playing);
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const bars = useRef<[Bar, Bar]>([RESTING_BAR, RESTING_BAR]);
  const parts = useRef<[Parts, Parts]>([
    { fill: null, hold: null, over: null },
    { fill: null, hold: null, over: null },
  ]);
  const readout = useRef<HTMLSpanElement>(null);

  const paint = useCallback(() => {
    bars.current.forEach((bar, side) => {
      const { fill, hold, over } = parts.current[side];
      if (fill) fill.style.clipPath = `inset(${percent(1 - meterFill(bar.db))} 0 0 0)`;
      if (hold) {
        // Hung from its top edge, so a peak at full scale still shows inside the bar.
        hold.style.top = percent(1 - meterFill(bar.holdDb));
        hold.style.opacity = bar.holdDb === -Infinity ? "0" : "1";
      }
      if (over) over.dataset.over = String(bar.over);
    });
    const text = dbLabel(Math.max(bars.current[0].holdDb, bars.current[1].holdDb));
    if (readout.current && readout.current.textContent !== text) readout.current.textContent = text;
  }, []);

  const clearOver = useCallback(() => {
    bars.current = [
      { ...bars.current[0], over: false },
      { ...bars.current[1], over: false },
    ];
    paint();
  }, [paint]);

  useEffect(() => {
    if (playing) clearOver(); // each play starts with the lights off
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = 0;
      const seconds = Math.min(0.25, Math.max(0, (now - last) / 1000)); // a tab that slept does not drop the bars at once
      last = now;
      const levels = bus?.levels() ?? null;
      bars.current = [advanceBar(bars.current[0], levels?.left ?? 0, seconds), advanceBar(bars.current[1], levels?.right ?? 0, seconds)];
      paint();
      if (store.getState().playing || !bars.current.every(barAtRest)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [bus, playing, store, paint, clearOver]);

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!menu) return;
    menu({
      ...menuPoint(e),
      label: "Audio meter",
      items: toItems([{ id: "hide", label: "Hide audio meter", command: "toggle-audio-meter" }]),
      onSelect: () => store.getState().setShowAudioMeter(false),
    });
  }

  return (
    <div
      role="group"
      aria-label="Audio meter"
      data-audio-meter
      onContextMenu={onContextMenu}
      className="flex w-14 shrink-0 flex-col items-stretch gap-1 border-l border-ed-line bg-ed-panel px-1.5 pt-1.5 pb-1 select-none"
    >
      <span ref={readout} aria-hidden className="text-center text-[10px] leading-3 text-ed-muted tabular-nums">
        -∞
      </span>
      <div className="flex min-h-0 flex-1 gap-1">
        {/* The scale: a number at each marked level, level with its line across the bars. */}
        <div aria-hidden className="relative w-4 shrink-0">
          <div className="absolute inset-x-0 top-3 bottom-0">
            {METER_TICKS.map((db) => (
              <span
                key={db}
                className="absolute right-0 -translate-y-1/2 text-[9px] leading-none text-ed-faint tabular-nums"
                style={{ top: percent(1 - meterFill(db)) }}
              >
                {-db}
              </span>
            ))}
          </div>
        </div>
        {SIDES.map((name, side) => (
          <div key={name} className="flex min-w-0 flex-1 flex-col gap-1">
            <button
              type="button"
              aria-label={`Clear the ${name === "L" ? "left" : "right"} overload light`}
              title={OVER_HINT}
              onClick={clearOver}
              className={cx("h-2 w-full shrink-0 rounded-[2px] bg-ed-raised", FOCUS_RING_INSET)}
            >
              <span
                ref={(el) => {
                  parts.current[side].over = el;
                }}
                data-over="false"
                className="block size-full rounded-[2px] bg-ed-danger opacity-0 data-[over=true]:opacity-100"
              />
            </button>
            <div aria-hidden className="relative min-h-0 flex-1 overflow-hidden rounded-[2px] bg-ed-bg">
              <div
                ref={(el) => {
                  parts.current[side].fill = el;
                }}
                data-meter-fill
                className="absolute inset-0"
                style={{ background: ZONES, clipPath: "inset(100% 0 0 0)" }}
              />
              {METER_TICKS.map((db) => (
                <span key={db} className="absolute inset-x-0 h-px bg-ed-panel/70" style={{ top: percent(1 - meterFill(db)) }} />
              ))}
              <div
                ref={(el) => {
                  parts.current[side].hold = el;
                }}
                data-meter-hold
                className="absolute inset-x-0 h-0.5 bg-ed-text opacity-0"
                style={{ top: "100%" }}
              />
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-1 pl-5 text-center text-[9px] leading-3 text-ed-faint">
        <span className="flex-1">L</span>
        <span className="flex-1">R</span>
      </div>
    </div>
  );
}
