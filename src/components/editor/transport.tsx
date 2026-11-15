"use client";

import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { formatTimecode } from "@/lib/editor/geometry";
import { parseTime } from "@/lib/editor/parse-time";
import { platformView, platformViewsFor } from "@/lib/editor/platform-views";
import { viewDoc } from "@/lib/editor/store";
import { docDuration } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";
import { Timecode } from "./timecode";
import { useShortcutLabel } from "./use-shortcuts";

// "2×", or "−2×" when playing backward.
const rateLabel = (rate: number) => (rate < 0 ? `−${-rate}×` : `${rate}×`);

// The play controls, in the control row above the timeline. Playback is not an edit, so they work for a viewer too.
export function TransportButtons() {
  const playing = useEditor((s) => s.playing);
  const duration = useEditor((s) => docDuration(viewDoc(s)));
  const seek = useEditor((s) => s.seek);
  const step = useEditor((s) => s.step);
  const play = useEditor((s) => s.play);
  const pause = useEditor((s) => s.pause);
  const keyFor = useShortcutLabel();
  const playKey = keyFor("play-pause");

  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton label="Go to start" shortcut={keyFor("go-start")} onClick={() => seek(0)}>
        <SkipBack />
      </IconButton>
      <IconButton label="Back one frame" shortcut={keyFor("frame-back")} onClick={() => step(-1)}>
        <StepBack />
      </IconButton>
      {playing ? (
        <IconButton label="Pause" shortcut={playKey} className="[&>svg]:text-ed-accent" onClick={() => pause()}>
          <Pause />
        </IconButton>
      ) : (
        <IconButton label="Play" shortcut={playKey} className="[&>svg]:text-ed-accent" disabled={duration === 0} onClick={() => play()}>
          <Play />
        </IconButton>
      )}
      <IconButton label="Forward one frame" shortcut={keyFor("frame-forward")} onClick={() => step(1)}>
        <StepForward />
      </IconButton>
      <IconButton label="Go to end" shortcut={keyFor("go-end")} onClick={() => seek(duration)}>
        <SkipForward />
      </IconButton>
    </div>
  );
}

// How fast playback runs, while it is not 1×.
export function RateBadge() {
  const playing = useEditor((s) => s.playing);
  const rate = useEditor((s) => s.rate);
  if (!playing || rate === 1) return null;
  return (
    <span className="shrink-0 rounded-[4px] border border-ed-line px-1.5 font-mono text-[11px] leading-4 font-medium text-ed-muted tabular-nums">
      {rateLabel(rate)}
    </span>
  );
}

// Its own component, so only the readout re-renders while the playhead moves. Double-click the time (or press Enter on
// it) to type one and jump there: "0:02:10", "1:30" or "12" all work, and a time past the end stops at the end.
export function TimeReadout({ duration, fps }: { duration: number; fps: number }) {
  const store = useEditorStore();
  const playhead = useEditor((s) => s.playhead);
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false); // a key ended the edit, so focus goes back to the time

  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [editing]);

  function open() {
    store.getState().pause(); // the field holds still while you type, and so does the frame
    setEditing(true);
  }

  function onDone(value: string | null, byKey: boolean) {
    refocus.current = byKey;
    const frame = value === null ? null : parseTime(value, fps);
    if (frame !== null) store.getState().seek(Math.min(frame, duration));
    setEditing(false);
  }

  return (
    <p className="flex shrink-0 items-center pl-1 text-xs leading-4 whitespace-nowrap text-ed-muted">
      {editing ? (
        // The field's own box is full width, so this wrapper gives it its width: room for "1:00:03:15".
        <span className="-ml-2 w-[13ch] font-mono text-xs">
          <InlineEdit
            label="Go to time"
            defaultValue={formatTimecode(playhead, fps)}
            maxLength={16}
            accepts={(v) => parseTime(v, fps) !== null}
            onDone={onDone}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs tabular-nums"
          />
        </span>
      ) : (
        <button
          ref={button}
          type="button"
          aria-label={`Current time ${formatTimecode(playhead, fps)}`}
          title="Double-click to go to a time"
          onDoubleClick={open}
          // A keyboard press has no click count; a mouse needs the double-click, so a stray click never opens it.
          onClick={(e) => e.detail === 0 && open()}
          className={cx("-ml-1 rounded px-1 text-ed-text hover:bg-ed-hover", FOCUS_RING, FADE)}
        >
          <Timecode frame={playhead} fps={fps} />
        </button>
      )}
      <span className="whitespace-pre">{" / "}</span>
      <Timecode frame={duration} fps={fps} />
    </p>
  );
}

const OFF = "off";
const SAFE = "safe";
const GUIDES = "guides";
const VIEW_AS_KEY = "easyedit.viewAs"; // this browser's last platform view

function readViewAs(): string | null {
  try {
    return window.localStorage.getItem(VIEW_AS_KEY);
  } catch {
    return null; // storage blocked
  }
}

function writeViewAs(id: string | null) {
  try {
    if (id) window.localStorage.setItem(VIEW_AS_KEY, id);
    else window.localStorage.removeItem(VIEW_AS_KEY);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

// "View as": Off, the safe area, or how one platform shows a frame of this shape. A platform choice is this
// browser's own and comes back next time when the project's shape offers it; it only changes what is seen.
export function ViewAsMenu() {
  const store = useEditorStore();
  const width = useEditor((s) => viewDoc(s).width);
  const height = useEditor((s) => viewDoc(s).height);
  const size = { width, height };
  const showSafeZones = useEditor((s) => s.showSafeZones);
  const view = platformView(size, useEditor((s) => s.viewAs));

  useEffect(() => {
    const saved = readViewAs();
    if (saved && !store.getState().showSafeZones && platformView(viewDoc(store.getState()), saved)) store.getState().setViewAs(saved);
  }, [store]);

  const current = view ? view.id : showSafeZones ? SAFE : OFF;
  const text = view ? view.label : showSafeZones ? "Safe area" : "Off";

  function items(): MenuItem[] {
    return [
      { id: OFF, label: "Off", radio: true, checked: current === OFF },
      { id: SAFE, label: "Safe area", radio: true, checked: current === SAFE },
      ...platformViewsFor(size).map((v, i) => ({ id: v.id, label: v.label, radio: true, checked: current === v.id, separatorBefore: i === 0 })),
      // The project's guides: a switch of this browser's own, apart from the views above.
      { id: GUIDES, label: "Show guides", checked: store.getState().showGuides, separatorBefore: true },
    ];
  }

  function onSelect(id: string) {
    const state = store.getState();
    if (id === GUIDES) {
      state.setShowGuides(!state.showGuides);
    } else if (id === SAFE) {
      if (!state.showSafeZones) state.toggleSafeZones();
      writeViewAs(null);
    } else if (id === OFF) {
      if (state.showSafeZones) state.toggleSafeZones();
      state.setViewAs(null);
      writeViewAs(null);
    } else {
      state.setViewAs(id);
      writeViewAs(id);
    }
  }

  return <Menu label={`View as: ${text}`} title="View as" text={`View as: ${text}`} className="max-w-56 justify-between" items={items} onSelect={onSelect} />;
}
