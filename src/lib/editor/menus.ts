import { docDuration } from "@/lib/timeline";
import { zoomLimits } from "./geometry";
import { SHORTCUTS, type CommandId } from "./shortcuts";
import type { EditorState } from "./store";

// One entry of a menu, as data. command: the shortcut-table command it runs, whose key is shown as
// its hint. edit: it changes the project, so its control is marked as an edit control.
export type MenuEntry = {
  id: string;
  label: string;
  command?: CommandId;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  edit?: boolean;
};

// What the Edit and View menus need to know, read when one opens.
export type TopMenuInput = {
  canEdit: boolean;
  deleted: boolean;
  busy: boolean; // a drag or a field being typed in
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  snapping: boolean;
  showSafeZones: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
};

const EDITS = new Set(SHORTCUTS.filter((s) => s.edits).map((s) => s.command));

export function topMenuInput(state: EditorState, canPaste: boolean): TopMenuInput {
  const { min, max } = zoomLimits(docDuration(state.doc), state.doc.fps);
  return {
    canEdit: state.canEdit,
    deleted: state.status === "deleted",
    busy: state.gesture !== null,
    hasSelection: state.selection.clipIds.length > 0,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    canPaste,
    snapping: state.snapping,
    showSafeZones: state.showSafeZones,
    canZoomIn: state.zoom < max,
    canZoomOut: state.zoom > min,
  };
}

type CommandEntry = { command: CommandId; label: string; separatorBefore?: boolean; unavailable?: boolean };

// A command's entry. One that changes the project is also greyed when the person cannot edit right
// now (a viewer, a deleted project, a drag in progress), as runCommand would ignore it.
function commandEntry(input: TopMenuInput, { command, label, separatorBefore, unavailable = false }: CommandEntry): MenuEntry {
  const edit = EDITS.has(command);
  const blocked = edit && (!input.canEdit || input.deleted || input.busy);
  return {
    id: command,
    label,
    command,
    disabled: blocked || unavailable,
    ...(separatorBefore && { separatorBefore }),
    ...(edit && { edit }),
  };
}

export function editMenu(input: TopMenuInput): MenuEntry[] {
  const noSelection = !input.hasSelection;
  const entries: CommandEntry[] = [
    { command: "undo", label: "Undo", unavailable: !input.canUndo },
    { command: "redo", label: "Redo", unavailable: !input.canRedo },
    { command: "cut", label: "Cut", separatorBefore: true, unavailable: noSelection },
    { command: "copy", label: "Copy", unavailable: noSelection },
    { command: "paste", label: "Paste", unavailable: !input.canPaste },
    { command: "split", label: "Split", separatorBefore: true },
    { command: "delete", label: "Delete", unavailable: noSelection },
    { command: "ripple-delete", label: "Ripple delete", unavailable: noSelection },
    { command: "select-all", label: "Select all", separatorBefore: true },
    { command: "clear-selection", label: "Deselect all" },
  ];
  return entries.map((entry) => commandEntry(input, entry));
}

// The zoom entries name the timeline, so neither reads as the preview's zoom. Safe zones and Reset
// panel sizes are not commands: the top bar handles them by id.
export function viewMenu(input: TopMenuInput): MenuEntry[] {
  return [
    commandEntry(input, { command: "zoom-in", label: "Zoom in on the timeline", unavailable: !input.canZoomIn }),
    commandEntry(input, { command: "zoom-out", label: "Zoom out on the timeline", unavailable: !input.canZoomOut }),
    commandEntry(input, { command: "zoom-fit", label: "Fit the timeline" }),
    { ...commandEntry(input, { command: "toggle-snapping", label: "Snapping", separatorBefore: true }), checked: input.snapping },
    { id: "safe-zones", label: "Safe zones", checked: input.showSafeZones },
    { id: "reset-layout", label: "Reset panel sizes", separatorBefore: true },
    commandEntry(input, { command: "show-shortcuts", label: "Keyboard shortcuts" }),
  ];
}
