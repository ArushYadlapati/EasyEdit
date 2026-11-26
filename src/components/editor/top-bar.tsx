"use client";

import { Keyboard, Redo2, SettingsIcon, Undo2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { LogoMark } from "@/components/ui/logo";
import { Menu } from "@/components/ui/menu";
import { addAdjustmentLayer, addText, addTrack } from "@/lib/editor/actions";
import { editMenu, topMenuInput, viewMenu, type MenuEntry, type TopMenuInput, guideLinkOf, helpMenu, type GuideLink } from "@/lib/editor/menus";
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
import { PeopleCount, SaveMark } from "./top-bar-compact";
import { TimelineFileDialog, type TimelineFileMode } from "./timeline-file-dialog";
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
  guide?: readonly GuideLink[]; // the guide's lessons, for the Help menu and the search; none on a server without it
};

const NO_GUIDE: readonly GuideLink[] = [];
// A lesson opens in a tab of its own, so the project stays open behind it.
const openLesson = (path: string) => void window.open(path, "_blank", "noopener");

// The row across the top, in three parts. Left: the logo with Projects (back to the space), the Edit, View and (on a
// server with the guide) Help menus and the project's name. Middle: the search, centred on the window while both sides fit. Right: the save status, the undo,
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
  guide = NO_GUIDE,
}: TopBarProps) {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const clipboard = useClipboard();
  const { fonts } = useBrand().kit;
  const run = useCommandRunner(onShowShortcuts, onExport);
  const [renameRequest, setRenameRequest] = useState(0);
  const [timelineFile, setTimelineFile] = useState<TimelineFileMode | null>(null);
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
  // Undo that takes the last change (or Redo the last undone one) turns itself off, and focus would drop to the
  // page; it goes to the other button instead, which that same press has just turned on.
  const undoButton = useRef<HTMLButtonElement>(null);
  const redoButton = useRef<HTMLButtonElement>(null);
  const handOver = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const to = handOver.current;
    handOver.current = null;
    if (to && !to.disabled) to.focus();
  }, [undoLabel, redoLabel]);
  function pressThenHandOver(e: MouseEvent<HTMLButtonElement>, run: () => void, stack: "undoStack" | "redoStack", other: RefObject<HTMLButtonElement | null>) {
    const focused = e.currentTarget === document.activeElement;
    run();
    if (focused && store.getState()[stack].length === 0) handOver.current = other.current;
  }

  const itemsOf = (menu: (input: TopMenuInput) => MenuEntry[]) => () =>
    toItems(menu(topMenuInput(store.getState(), clipboard.read() !== null)));
  function pick(id: string) {
    const lesson = guideLinkOf(id, guide);
    if (lesson) openLesson(lesson.path);
    else if (id === "safe-zones") store.getState().toggleSafeZones();
    else if (id === "reset-layout") onResetLayout?.();
    else if (id === "save-template") onSaveTemplate?.();
    else if (id === "import-timeline") setTimelineFile("import");
    else if (id === "export-timeline") setTimelineFile("export");
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
      guide,
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
      case "adjustment":
        return void addAdjustmentLayer(store);
      case "timeline-file":
        return setTimelineFile(action.mode);
      case "panel":
        return onOpenPanel?.(action.side, action.tab);
      case "settings":
        return onShowSettingsAt ? onShowSettingsAt(action.page) : onShowSettings?.();
      case "guide":
        return openLesson(action.path);
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
    // Below the lg width (a phone, a narrow window) everything stays but in a smaller form: the search folds to its
    // mark and opens across the bar, the save status is a mark (with a word when something needs knowing), who else
    // is here is one count, and the keyboard list gives way. The search key opens the search at every width.
    <header className="relative grid min-w-0 items-center gap-3 bg-ed-panel px-3 max-lg:grid-cols-[minmax(0,1fr)_auto_auto] max-lg:gap-1 max-lg:px-1.5 lg:col-span-3 lg:grid-cols-[minmax(0,1fr)_minmax(9rem,clamp(12rem,28vw,24rem))_minmax(max-content,1fr)]">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden max-lg:gap-1">
        <LeaveLink
          href={spacePath(spaceSlug)}
          className={cx(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1.5 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text",
            FOCUS_RING,
            FADE,
          )}
        >
          <LogoMark size={16} />
          <span className="max-lg:sr-only">Projects</span>
        </LeaveLink>
        <span aria-hidden className="h-4 w-px shrink-0 bg-ed-line" />
        <div className="flex shrink-0 items-center">
          <Menu label="Edit" disabled={deleted} items={itemsOf(editMenu)} onSelect={pick} />
          <Menu label="View" disabled={deleted} items={itemsOf(viewMenu)} onSelect={pick} />
          {/* The guide's lessons, for a window with room for them; a deleted project's editor can still be learnt from. */}
          {guide.length > 0 && (
            <div className="contents max-lg:hidden">
              <Menu label="Help" items={itemsOf((input) => helpMenu(input, guide))} onSelect={pick} />
            </div>
          )}
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
      <FeatureSearch items={searchList} onRun={runFound} inputRef={searchRef ?? ownSearch} fold />
      <TimelineFileDialog mode={timelineFile} onClose={() => setTimelineFile(null)} />
      <div className="flex items-center justify-end gap-2 max-lg:gap-0.5">
        {/* One of each at every width, so what a screen reader hears never doubles; below the lg width the dots and
            the words are kept for it and the count and mark beside them are what shows. */}
        <div className="contents max-lg:[&>[role=group]]:hidden max-lg:[&>[role=status]]:sr-only">
          <EditingIndicator />
        </div>
        <PeopleCount className="lg:hidden" />
        <SaveMark className="lg:hidden" />
        <div className="shrink-0 max-lg:[&_[role=status]]:sr-only">
          <SaveStatus />
        </div>
        <IconButton
          data-edit-control
          label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
          shortcut={keyFor("undo")}
          disabled={!canEdit || deleted || undoLabel === undefined}
          ref={undoButton}
          onClick={(e) => pressThenHandOver(e, () => undo(), "undoStack", redoButton)}
        >
          <Undo2 />
        </IconButton>
        <IconButton
          data-edit-control
          label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
          shortcut={keyFor("redo")}
          disabled={!canEdit || deleted || redoLabel === undefined}
          ref={redoButton}
          onClick={(e) => pressThenHandOver(e, () => redo(), "redoStack", undoButton)}
        >
          <Redo2 />
        </IconButton>
        {/* A viewer's own preferences are in Settings too, and so it opens for a deleted project. */}
        <IconButton label="Settings" onClick={onShowSettings}>
          <SettingsIcon />
        </IconButton>
        <IconButton className="max-lg:hidden" label="Keyboard shortcuts" shortcut={keyFor("show-shortcuts")} onClick={onShowShortcuts}>
          <Keyboard />
        </IconButton>
        <span aria-hidden className="h-4 w-px shrink-0 bg-ed-line max-lg:hidden" />
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
