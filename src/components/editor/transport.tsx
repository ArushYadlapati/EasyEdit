"use client";

import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useEffect, useMemo } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { platformView, platformViewsFor } from "@/lib/editor/platform-views";
import { viewDoc } from "@/lib/editor/store";
import { docDuration, formatLabel } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";
import { Timecode } from "./timecode";
import { useShortcutLabel } from "./use-shortcuts";
import { ZoomMenu } from "./zoom-menu";

// "2×", or "−2×" when playing backward.
const rateLabel = (rate: number) => (rate < 0 ? `−${-rate}×` : `${rate}×`);

// The bar under the preview. Playback is not an edit, so every control here works for a viewer too.
export function Transport() {
  const doc = useEditor(viewDoc);
  const playing = useEditor((s) => s.playing);
  const rate = useEditor((s) => s.rate);
  const seek = useEditor((s) => s.seek);
  const step = useEditor((s) => s.step);
  const play = useEditor((s) => s.play);
  const pause = useEditor((s) => s.pause);
  const duration = useMemo(() => docDuration(doc), [doc]);
  const keyFor = useShortcutLabel();
  const playKey = keyFor("play-pause");

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-ed-line bg-ed-panel px-3">
      <div className="flex items-center gap-1">
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
      <TimeReadout duration={duration} fps={doc.fps} />
      {playing && rate !== 1 && (
        <span className="shrink-0 rounded-[4px] border border-ed-line px-1.5 font-mono text-[11px] leading-4 font-medium text-ed-muted tabular-nums">
          {rateLabel(rate)}
        </span>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <ZoomMenu />
        <ViewAsMenu />
        <span className="truncate text-xs text-ed-muted">{formatLabel(doc)}</span>
      </div>
    </div>
  );
}

// Its own component, so only the readout re-renders while the playhead moves.
function TimeReadout({ duration, fps }: { duration: number; fps: number }) {
  const playhead = useEditor((s) => s.playhead);
  return (
    <p className="shrink-0 pl-1 text-xs leading-4 whitespace-nowrap text-ed-muted">
      <Timecode frame={playhead} fps={fps} className="text-ed-text" />
      {" / "}
      <Timecode frame={duration} fps={fps} />
    </p>
  );
}

const OFF = "off";
const SAFE = "safe";
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
function ViewAsMenu() {
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
    ];
  }

  function onSelect(id: string) {
    const state = store.getState();
    if (id === SAFE) {
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
