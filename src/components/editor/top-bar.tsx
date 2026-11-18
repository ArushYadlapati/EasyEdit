"use client";

import { Keyboard, Redo2, SettingsIcon, Undo2 } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { LogoMark } from "@/components/ui/logo";
import { Menu } from "@/components/ui/menu";
import { addText, addTrack } from "@/lib/editor/actions";
import { editMenu, topMenuInput, viewMenu, type MenuEntry, type TopMenuInput } from "@/lib/editor/menus";
import { searchItems, type PanelSide, type SearchItem, type SettingsPage } from "@/lib/editor/search";
import { TEXT_PRESETS } from "@/lib/editor/text-presets";
import { LIMITS } from "@/lib/limits";
import type { CommandId } from "@/lib/editor/shortcuts";
import { useBrand } from "./brand/brand-context";
import { useClipboard, useEditor, useEditorStore, useSettingsStore } from "./context";
import { EditingIndicator } from "./editing-indicator";
import { FeatureSearch } from "./feature-search";
import { LeaveLink } from "./leave-link";
import { LEFT_TABS } from "./left-panel";
import { useToMenuItems } from "./menu-items";
import { spacePath } from "@/lib/spaces/paths";
import { ProjectName } from "./project-name";
import { RIGHT_TABS } from "./right-panel";
import { SaveStatus } from "./save-status";
import { useCommandRunner, useShortcutLabel } from "./use-shortcuts";

type TopBarProps = {
  spaceSlug: string; // the space the project is in: Projects leads back to its dashboard
  onShowShortcuts(): void;
  onShowSettings?(): void;
  onResetLayout?(): void; // View → Reset panel sizes
  onExport?(): void; // opens the Export dialog
  onSaveTemplate?(): void; // Edit → Save as template…, opens its dialog
  exportPercent?: number | null; // how far a running export is; null or absent when none runs
  onShowSettingsAt?(page: SettingsPage): void; // the search opens Settings at a page
  onOpenPanel?(side: PanelSide, tab: string): void; // the search opens a panel's tab
  searchRef?: RefObject<HTMLInputElement | null>; // the search key focuses the field
};

// The row across the top, in three parts. Left: the logo with Projects (back to the space), the Edit and View menus and
// the project's name. Middle: the search, centred on the window while both sides fit. Right: the save status, the undo,
// redo, settings and shortcuts buttons, and Export. The menus and the search read the editor as they open, so what
// cannot run right then is greyed.
export function TopBar({
  spaceSlug,
  onShowShortcuts,
  onShowSettings,
  onResetLayout,
  onExport,
  onSaveTemplate,
  exportPercent = null,
  onShowSettingsAt,
  onOpenPanel,
  searchRef,
}: TopBarProps) {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const clipboard = useClipboard();
  const { fonts } = useBrand().kit;
  const run = useCommandRunner(onShowShortcuts, onExport);
  const [renameRequest, setRenameRequest] = useState(0);
  const ownSearch = useRef<HTMLInputElement>(null);
  const canEdit = useEditor((s) => s.canEdit);
  const moved = useEditor((s) => s.moved);
  const status = useEditor((s) => s.status);
  const undoLabel = useEditor((s) => s.undoStack.at(-1)?.label);
  const redoLabel = useEditor((s) => s.redoStack.at(-1)?.label);
  const deleted = status === "deleted";
  const exportHeld = useEditor((s) => s.exportHeld);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const keyFor = useShortcutLabel();
  const toItems = useToMenuItems();

  const itemsOf = (menu: (input: TopMenuInput) => MenuEntry[]) => () =>
    toItems(menu(topMenuInput(store.getState(), clipboard.read() !== null)));
  function pick(id: string) {
    if (id === "safe-zones") store.getState().toggleSafeZones();
    else if (id === "reset-layout") onResetLayout?.();
    else if (id === "save-template") onSaveTemplate?.();
    else run(id as CommandId);
  }

  function searchList(): SearchItem[] {
    const state = store.getState();
    return searchItems({
      ...topMenuInput(state, clipboard.read() !== null),
      leftTabs: onOpenPanel ? LEFT_TABS : [],
      rightTabs: onOpenPanel ? RIGHT_TABS : [],
      trackCount: state.doc.tracks.length,
      hasCaptions: state.doc.tracks.some((t) => t.kind === "caption"),
      canSaveTemplate: onSaveTemplate !== undefined,
    });
  }

  function runFound(item: SearchItem) {
    const { action } = item;
    const state = store.getState();
    switch (action.kind) {
      case "command":
        return run(action.command);
      case "shape":
        if (state.setTool("shape")) state.setShapeTool(action.shape);
        return;
      case "text": {
        const preset = TEXT_PRESETS.find((p) => p.id === action.preset);
        if (preset) addText(store, preset, settings.getState().textSeconds, fonts);
        return;
      }
      case "track":
        if (state.doc.tracks.length < LIMITS.tracksPerProject) addTrack(store, action.track);
        return;
      case "panel":
        return onOpenPanel?.(action.side, action.tab);
      case "settings":
        return onShowSettingsAt ? onShowSettingsAt(action.page) : onShowSettings?.();
      case "safe-zones":
        return state.toggleSafeZones();
      case "reset-layout":
        return onResetLayout?.();
      case "save-template":
        return onSaveTemplate?.();
      case "rename":
        return setRenameRequest((n) => n + 1);
    }
  }

  return (
    // The middle column keeps its width while the sides can give way: the project name first, as before.
    <header className="col-span-3 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(9rem,clamp(12rem,28vw,24rem))_minmax(max-content,1fr)] items-center gap-3 bg-ed-panel px-3">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <LeaveLink
          href={spacePath(spaceSlug)}
          className={cx(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1.5 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text",
            FOCUS_RING,
            FADE,
          )}
        >
          <LogoMark size={16} className="text-ed-text" />
          Projects
        </LeaveLink>
        <span aria-hidden className="h-4 w-px shrink-0 bg-ed-line" />
        <div className="flex shrink-0 items-center">
          <Menu label="Edit" disabled={deleted} items={itemsOf(editMenu)} onSelect={pick} />
          <Menu label="View" disabled={deleted} items={itemsOf(viewMenu)} onSelect={pick} />
        </div>
        <span aria-hidden className="h-4 w-px shrink-0 bg-ed-line" />
        <ProjectName renameRequest={renameRequest} />
        {/* A moved project's editing is off too, and its banner says why. */}
        {!canEdit && !moved && (
          <span className="shrink-0 rounded-[4px] border border-ed-line px-1.5 text-[11px] leading-4 font-medium text-ed-muted">
            View only
          </span>
        )}
      </div>
      <FeatureSearch items={searchList} onRun={runFound} inputRef={searchRef ?? ownSearch} />
      <div className="flex items-center justify-end gap-2">
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
        {/* Not an edit: a viewer exports too. A project deleted during an export keeps the way back to its progress,
            and to a file waiting for Download. */}
        <Button
          variant={exportPercent === null ? "primary" : "default"}
          className="tabular-nums"
          title={keyFor("export") ? `Export (${keyFor("export")})` : "Export"}
          disabled={deleted && exportPercent === null && !exportHeld}
          onClick={onExport}
        >
          {exportPercent === null ? "Export" : `Exporting ${exportPercent}%`}
        </Button>
      </div>
    </header>
  );
}
