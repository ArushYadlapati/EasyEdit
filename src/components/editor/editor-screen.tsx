"use client";

import { useCallback, useState } from "react";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { DEFAULT_LAYOUT, createLayoutStore, type Layout } from "@/lib/editor/layout";
import { writeLayoutCookie } from "./browser-prefs";
import { useEditor } from "./context";
import { LeaveLink } from "./leave-link";
import { LeftPanel } from "./left-panel";
import { NoticeBar } from "./notice-bar";
import { PanelGrid } from "./panel-grid";
import { Preview } from "./preview";
import { RightPanel } from "./right-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Timeline } from "./timeline/timeline";
import { TopBar } from "./top-bar";
import { useShortcuts } from "./use-shortcuts";

type EditorScreenProps = {
  initialLayout?: Layout; // the panel sizes this browser kept
  saveLayout?(layout: Layout): void; // keeps the sizes once a resize ends
};

// The whole editor, drawn from the store in context. Always dark and exactly as tall as the window:
// top bar, then the add panel, preview and details side by side, then the timeline across the bottom.
// The keyboard shortcuts work anywhere in the window. The panel grid alone follows the panel sizes, so
// resizing a panel does not draw the panels again.
export function EditorScreen({ initialLayout = DEFAULT_LAYOUT, saveLayout = writeLayoutCookie }: EditorScreenProps) {
  const deleted = useEditor((s) => s.status === "deleted");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [layout] = useState(() => createLayoutStore(initialLayout, saveLayout));
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useShortcuts(openShortcuts);

  return (
    <div className="editor relative h-dvh overflow-hidden bg-ed-bg font-sans text-ed-text [--ed-left-w:240px] [--ed-right-w:280px] [--ed-timeline-h:clamp(220px,36vh,360px)]">
      <PanelGrid
        layout={layout}
        deleted={deleted}
        top={<TopBar onShowShortcuts={openShortcuts} onResetLayout={() => layout.getState().reset()} />}
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
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
