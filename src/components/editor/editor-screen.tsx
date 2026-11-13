"use client";

import { useCallback, useEffect, useState } from "react";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { DEFAULT_LAYOUT, LAYOUT_COOKIE, createLayoutStore, formatLayout, parseLayout, type Layout } from "@/lib/editor/layout";
import { readCookie, writeLayoutCookie } from "./browser-prefs";
import { useEditor } from "./context";
import { LeaveLink } from "./leave-link";
import { LeftPanel } from "./left-panel";
import { NoticeBar } from "./notice-bar";
import { PanelGrid } from "./panel-grid";
import { Preview } from "./preview";
import { RightPanel } from "./right-panel";
import { SettingsDialog, type SettingsSection } from "./settings-dialog";
import { Timeline } from "./timeline/timeline";
import { TopBar } from "./top-bar";
import { useShortcuts } from "./use-shortcuts";

type EditorScreenProps = {
  initialLayout?: Layout; // the panel sizes this browser kept
  saveLayout?(layout: Layout): void; // keeps the sizes once a resize ends
};

// The whole editor, drawn from the store in context. Always dark and exactly as tall as the window:
// top bar, then the add panel, preview and details side by side, then the timeline across the bottom.
// The keyboard shortcuts work anywhere in the window, and any part can open a right-click menu. The panel
// grid alone follows the panel sizes, so resizing a panel does not draw the panels again.
export function EditorScreen({ initialLayout = DEFAULT_LAYOUT, saveLayout = writeLayoutCookie }: EditorScreenProps) {
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
  useShortcuts(openShortcuts);

  return (
    <div className="editor relative h-dvh overflow-hidden bg-ed-bg font-sans text-ed-text [--ed-left-w:240px] [--ed-right-w:280px] [--ed-timeline-h:clamp(220px,36vh,360px)]">
      <ContextMenuProvider>
        <PanelGrid
          layout={layout}
          deleted={deleted}
          top={
            <TopBar
              onShowShortcuts={openShortcuts}
              onShowSettings={() => showSettingsAt(lastSection)}
              onResetLayout={() => layout.getState().reset()}
            />
          }
          left={<LeftPanel />}
          center={
            deleted ? (
              <>
                <p className="text-sm font-semibold">This project was deleted.</p>
                <LeaveLink
                  href="/dashboard"
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
      </ContextMenuProvider>
    </div>
  );
}
