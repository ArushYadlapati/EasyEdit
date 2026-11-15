"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { useStore } from "zustand";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { DEFAULT_LAYOUT, LAYOUT_COOKIE, createLayoutStore, formatLayout, parseLayout, type Layout } from "@/lib/editor/layout";
import { failureMessage } from "@/lib/export/messages";
import type { ExportOutcome } from "@/lib/export/protocol";
import { isBusy, progressFraction, type ExportState } from "@/lib/export/state";
import { readCookie, writeLayoutCookie } from "./browser-prefs";
import { useEditor, useEditorStore } from "./context";
import { ExportDialog } from "./export/export-dialog";
import { useExport, type Exporter } from "./export/use-export";
import { LeaveLink } from "./leave-link";
import { LeftPanel } from "./left-panel";
import { NoticeBar } from "./notice-bar";
import { PanelGrid } from "./panel-grid";
import { Preview } from "./preview";
import { RightPanel } from "./right-panel";
import { spacePath } from "@/lib/spaces/paths";
import { SettingsDialog, type SettingsSection } from "./settings-dialog";
import { Timeline } from "./timeline/timeline";
import { TopBar } from "./top-bar";
import { useShortcuts } from "./use-shortcuts";

type EditorScreenProps = {
  spaceSlug: string; // the space the project is in, for the way back to its dashboard
  initialLayout?: Layout; // the panel sizes this browser kept
  saveLayout?(layout: Layout): void; // keeps the sizes once a resize ends
};

// The whole editor, drawn from the store in context. Always dark and exactly as tall as the window:
// top bar, then the add panel, preview and details side by side, then the timeline across the bottom.
// The keyboard shortcuts work anywhere in the window, and any part can open a right-click menu. The panel
// grid alone follows the panel sizes, so resizing a panel does not draw the panels again.
export function EditorScreen({ spaceSlug, initialLayout = DEFAULT_LAYOUT, saveLayout = writeLayoutCookie }: EditorScreenProps) {
  const store = useEditorStore();
  const deleted = useEditor((s) => s.status === "deleted");
  const [settingsAt, setSettingsAt] = useState<SettingsSection | null>(null);
  const [lastSection, setLastSection] = useState<SettingsSection>("project"); // the gear opens it again
  const [layout] = useState(() => createLayoutStore(initialLayout, saveLayout));
  // The Back button can bring back an older page, painted with sizes older than the cookie: the cookie's are the
  // ones last chosen, so they are shown. They are already kept, so nothing is saved.
  useEffect(() => {
    const kept = readCookie(LAYOUT_COOKIE);
    if (kept === null) return;
    const sizes = parseLayout(kept);
    if (formatLayout(sizes) !== formatLayout(layout.getState().wanted)) layout.getState().load(sizes);
  }, [layout]);
  const showSettingsAt = useCallback((section: SettingsSection) => {
    setSettingsAt(section);
    setLastSection(section);
  }, []);
  const openShortcuts = useCallback(() => showSettingsAt("shortcuts"), [showSettingsAt]);
  const [exportOpen, setExportOpen] = useState(false);
  // An export that ends while its dialog is closed says so in a notice; an open dialog says it all itself. A held file
  // keeps the export's state at done, so Export opens again at its Download.
  const exporter = useExport({
    onFinish: (outcome: ExportOutcome, fileName: string, held: boolean) => {
      if (exportOpen) return;
      if (outcome.status === "done")
        store.getState().notify("info", held ? "Export finished. Open Export to download it." : `Export saved as ${fileName}.`);
      else if (outcome.status === "failed") store.getState().notify("error", failureMessage(outcome.code));
    },
  });
  // A deleted project exports nothing new, but a running export stays reachable for its progress and its Cancel, and a
  // file waiting for Download for its Download. The guard is read when it runs, so the function stays the same and the
  // keys are not hooked up again as an export starts and ends.
  const exportStore = exporter.store;
  const openExport = useCallback(() => {
    if (store.getState().status !== "deleted" || isBusy(exportStore.getState()) || store.getState().exportHeld)
      setExportOpen(true);
  }, [store, exportStore]);
  useShortcuts(openShortcuts, openExport);

  return (
    <div className="editor relative h-dvh overflow-hidden bg-ed-bg font-sans text-ed-text [--ed-left-w:240px] [--ed-right-w:280px] [--ed-timeline-h:clamp(220px,36vh,360px)]">
      <ContextMenuProvider>
        <PanelGrid
          layout={layout}
          deleted={deleted}
          top={
            <ExportingTopBar
              exporter={exporter}
              onShowShortcuts={openShortcuts}
              spaceSlug={spaceSlug}
              onShowSettings={() => showSettingsAt(lastSection)}
              onResetLayout={() => layout.getState().reset()}
              onExport={openExport}
            />
          }
          left={<LeftPanel />}
          center={
            deleted ? (
              <>
                <p className="text-sm font-semibold">This project was deleted.</p>
                <LeaveLink
                  href={spacePath(spaceSlug)}
                  className={cx("rounded-[4px] text-[13px] leading-5 text-ed-muted underline underline-offset-2 hover:text-ed-text", FOCUS_RING)}
                >
                  Back to projects
                </LeaveLink>
              </>
            ) : (
              <Preview />
            )
          }
          right={<RightPanel />}
          bottom={<Timeline />}
          overlay={<NoticeBar />}
        />
        <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center lg:hidden">
          <p className="text-sm font-semibold">The editor needs a wider window.</p>
          <p className="text-[13px] leading-5 text-ed-muted">Open this project on a laptop or desktop.</p>
        </div>
        <SettingsDialog at={settingsAt} onSection={showSettingsAt} onClose={() => setSettingsAt(null)} />
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} exporter={exporter} />
      </ContextMenuProvider>
    </div>
  );
}

// The whole percentage of a running export; null when none runs.
const exportPercentOf = (state: ExportState) => (isBusy(state) ? Math.floor(progressFraction(state) * 100) : null);

// The top bar with the export's percentage. Only this reads it, so a percentage that changes draws the top bar again
// and not the panels.
function ExportingTopBar({ exporter, ...props }: Omit<ComponentProps<typeof TopBar>, "exportPercent"> & { exporter: Exporter }) {
  const exportPercent = useStore(exporter.store, exportPercentOf);
  return <TopBar {...props} exportPercent={exportPercent} />;
}
