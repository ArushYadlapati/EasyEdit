import { BOX_SHAPES, docDuration } from "@/lib/timeline";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duckSelection,
  duplicateSelection,
  freezeFrame,
  goToEdge,
  goToMarker,
  groupSelection,
  nudgeSelection,
  paste,
  reverseSelection,
  selectAll,
  separateAudio,
  splitAtPlayhead,
  toggleMarker,
  ungroupSelection,
  stepVolume,
  toggleMute,
} from "./actions";
import type { ClipboardStore } from "./clipboard";
import { TRIM_MODES } from "./drag";
import { ZOOM_STEP } from "./geometry";
import { SHORTCUTS, type CommandId } from "./shortcuts";
import type { EditorState, EditorStore } from "./store";

// openExport and openSearch are left out where neither can be opened (the clip and canvas menus); their keys then do
// nothing. hasSound: whether a library file has sound, for Separate audio; without it every video counts as having some.
export type CommandContext = {
  store: EditorStore;
  clipboard: ClipboardStore;
  openShortcuts(): void;
  openExport?(): void;
  openSearch?(): void;
  hasSound?(assetId: string): boolean;
};

const EDITS = new Set(SHORTCUTS.filter((s) => s.edits).map((s) => s.command));

// A command that changes the project runs only for someone who can edit, never in the middle of a
// drag or a field being typed in (the gesture is saved or dropped first), and not once the project
// is gone. Signed out, edits go on and wait to be sent, as when offline. Select all and Deselect all
// wait out a gesture too: a selection change would end it half-way.
function canRun(command: CommandId, state: EditorState): boolean {
  if (command === "select-all" || command === "clear-selection") return state.gesture === null;
  if (!EDITS.has(command)) return true;
  return state.canEdit && state.gesture === null && state.status !== "deleted";
}

// Runs one command of the shortcut table.
export function runCommand(command: CommandId, ctx: CommandContext): void {
  const { store, clipboard } = ctx;
  const state = store.getState();
  if (!canRun(command, state)) return;
  const { fps } = state.doc;

  switch (command) {
    case "play-pause":
      if (state.playing) state.pause();
      else state.play();
      return;
    case "play-forward":
      return state.shuttle("l");
    case "pause":
      return state.shuttle("k");
    case "play-reverse":
      return state.shuttle("j");
    case "frame-back":
      return state.step(-1);
    case "frame-forward":
      return state.step(1);
    case "second-back":
      return state.step(-fps);
    case "second-forward":
      return state.step(fps);
    case "prev-edge":
      return goToEdge(store, "prev");
    case "next-edge":
      return goToEdge(store, "next");
    case "prev-marker":
      return goToMarker(store, "prev");
    case "next-marker":
      return goToMarker(store, "next");
    case "toggle-marker":
      return toggleMarker(store);
    case "go-start":
      return state.seek(0);
    case "go-end":
      return state.seek(docDuration(state.doc));
    case "undo":
      return state.undo();
    case "redo":
      return state.redo();
    case "tool-select":
      return void state.setTool("select");
    case "tool-razor":
      return void state.setTool("razor");
    case "tool-text":
      return void state.setTool("text");
    case "tool-shape":
      return void state.setTool("shape");
    case "tool-shape-next":
      if (state.setTool("shape")) state.setShapeTool(BOX_SHAPES[(BOX_SHAPES.indexOf(state.shapeTool) + 1) % BOX_SHAPES.length]);
      return;
    case "tool-line":
      if (state.setTool("line")) state.setLineTool("line");
      return;
    case "tool-arrow":
      if (state.setTool("line")) state.setLineTool("arrow");
      return;
    case "tool-guide":
      return void state.setTool("guide");
    case "tool-crop":
      return void state.setTool("crop");
    case "split":
      return splitAtPlayhead(store);
    case "delete":
      return deleteSelection(store, false);
    case "ripple-delete":
      return deleteSelection(store, true);
    case "copy":
      return copySelection(store, clipboard);
    case "cut":
      return cutSelection(store, clipboard);
    case "paste":
      return paste(store, clipboard);
    case "duplicate":
      return duplicateSelection(store);
    case "nudge-left":
      return nudgeSelection(store, -1);
    case "nudge-right":
      return nudgeSelection(store, 1);
    case "nudge-left-second":
      return nudgeSelection(store, -fps);
    case "nudge-right-second":
      return nudgeSelection(store, fps);
    case "group-clips":
      return groupSelection(store);
    case "ungroup-clips":
      return ungroupSelection(store);
    case "volume-up":
      return stepVolume(store, 1);
    case "volume-down":
      return stepVolume(store, -1);
    case "mute-clip":
      return toggleMute(store);
    case "separate-audio":
      return separateAudio(store, ctx.hasSound);
    case "duck-audio":
      return duckSelection(store);
    case "reverse-clip":
      return reverseSelection(store);
    case "freeze-frame":
      return freezeFrame(store);
    case "select-all":
      return selectAll(store);
    case "clear-selection":
      // Clears the selected clips and the selected track alike.
      return state.select([]);
    case "zoom-in":
      return state.zoomBy(ZOOM_STEP);
    case "zoom-out":
      return state.zoomBy(1 / ZOOM_STEP);
    case "zoom-fit":
      return state.zoomToFit();
    case "toggle-snapping":
      return state.setSnapping(!state.snapping);
    case "next-trim-mode":
      return state.setTrimMode(TRIM_MODES[(TRIM_MODES.indexOf(state.trimMode) + 1) % TRIM_MODES.length]);
    case "toggle-audio-meter":
      return state.setShowAudioMeter(!state.showAudioMeter);
    case "export":
      return ctx.openExport?.();
    case "show-shortcuts":
      return ctx.openShortcuts();
    case "search":
      return ctx.openSearch?.();
    default: {
      // A command added to CommandId without a case here does not compile.
      const missing: never = command;
      throw new Error(`No action for the command ${String(missing)}.`);
    }
  }
}
