"use client";

import { ChevronLeft, Keyboard, Redo2, SettingsIcon, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { Menu } from "@/components/ui/menu";
import { editMenu, topMenuInput, viewMenu, type MenuEntry, type TopMenuInput } from "@/lib/editor/menus";
import type { CommandId } from "@/lib/editor/shortcuts";
import { useClipboard, useEditor, useEditorStore } from "./context";
import { EditingIndicator } from "./editing-indicator";
import { LeaveLink } from "./leave-link";
import { useToMenuItems } from "./menu-items";
import { ProjectName } from "./project-name";
import { SaveStatus } from "./save-status";
import { useCommandRunner, useShortcutLabel } from "./use-shortcuts";

type TopBarProps = {
  onShowShortcuts(): void;
  onShowSettings?(): void;
  onResetLayout?(): void; // View → Reset panel sizes
  onExport?(): void; // opens the Export dialog
  exportPercent?: number | null; // how far a running export is; null or absent when none runs
};

// The row across the top: Projects, the Edit and View menus, the project's name, then the save
// status, the undo, redo, settings and shortcuts buttons, and Export. The menus read the editor as they open, so what
// cannot run right then is greyed.
export function TopBar({ onShowShortcuts, onShowSettings, onResetLayout, onExport, exportPercent = null }: TopBarProps) {
  const store = useEditorStore();
  const clipboard = useClipboard();
  const run = useCommandRunner(onShowShortcuts);
  const canEdit = useEditor((s) => s.canEdit);
  const status = useEditor((s) => s.status);
  const undoLabel = useEditor((s) => s.undoStack.at(-1)?.label);
  const redoLabel = useEditor((s) => s.redoStack.at(-1)?.label);
  const deleted = status === "deleted";
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const keyFor = useShortcutLabel();
  const toItems = useToMenuItems();

  const itemsOf = (menu: (input: TopMenuInput) => MenuEntry[]) => () =>
    toItems(menu(topMenuInput(store.getState(), clipboard.read() !== null)));
  function pick(id: string) {
    if (id === "safe-zones") store.getState().toggleSafeZones();
    else if (id === "reset-layout") onResetLayout?.();
    else run(id as CommandId);
  }

  return (
    <header className="col-span-3 flex min-w-0 items-center gap-2 bg-ed-panel px-3">
      <LeaveLink
        href="/dashboard"
        className={cx(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-md pr-2 pl-1 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text",
          FOCUS_RING,
          FADE,
        )}
      >
        <ChevronLeft aria-hidden size={16} strokeWidth={1.75} />
        Projects
      </LeaveLink>
      <span aria-hidden className="h-4 w-px shrink-0 bg-ed-line" />
      <div className="flex shrink-0 items-center">
        <Menu label="Edit" disabled={deleted} items={itemsOf(editMenu)} onSelect={pick} />
        <Menu label="View" disabled={deleted} items={itemsOf(viewMenu)} onSelect={pick} />
      </div>
      <span aria-hidden className="h-4 w-px shrink-0 bg-ed-line" />
      <ProjectName />
      {!canEdit && (
        <span className="shrink-0 rounded-[4px] border border-ed-line px-1.5 text-[11px] leading-4 font-medium text-ed-muted">
          View only
        </span>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-2 pl-2">
        <EditingIndicator />
        <div className="shrink-0">
          <SaveStatus />
        </div>
        <IconButton
          data-edit-control
          label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
          shortcut={keyFor("undo")}
          disabled={!canEdit || deleted || undoLabel === undefined}
          onClick={() => undo()}
        >
          <Undo2 />
        </IconButton>
        <IconButton
          data-edit-control
          label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
          shortcut={keyFor("redo")}
          disabled={!canEdit || deleted || redoLabel === undefined}
          onClick={() => redo()}
        >
          <Redo2 />
        </IconButton>
        {/* A viewer's own preferences are in Settings too, and so it opens for a deleted project. */}
        <IconButton label="Settings" onClick={onShowSettings}>
          <SettingsIcon />
        </IconButton>
        <IconButton label="Keyboard shortcuts" shortcut={keyFor("show-shortcuts")} onClick={onShowShortcuts}>
          <Keyboard />
        </IconButton>
        <span aria-hidden className="h-4 w-px shrink-0 bg-ed-line" />
        {/* Not an edit: a viewer exports too. A project deleted during an export keeps the way back to its progress. */}
        <Button
          variant={exportPercent === null ? "primary" : "default"}
          className="tabular-nums"
          disabled={deleted && exportPercent === null}
          onClick={onExport}
        >
          {exportPercent === null ? "Export" : `Exporting ${exportPercent}%`}
        </Button>
      </div>
    </header>
  );
}
