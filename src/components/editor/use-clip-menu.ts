"use client";

import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { resetCrop } from "@/lib/editor/actions";
import { clipMenu, rightClickEntries } from "@/lib/editor/menus";
import { useEditorStore } from "./context";
import { useToMenuItems } from "./menu-items";
import { useCommandRunner } from "./use-shortcuts";

// No right-click menu offers "Keyboard shortcuts", so its commands never open them.
const noShortcuts = () => {};

// Opens a clip's menu where it was right-clicked: the timeline's clips, and the preview's. The right-click
// selects the clip unless it is already selected (it is never toggled), and the menu is built for that
// selection. A pick runs its command as its key would; Reset crop, which has no key, resets the clip right-clicked.
// Outside a menu provider it only keeps the browser's menu shut.
export function useClipMenu(): (e: ReactMouseEvent, clipId: string, returnFocus?: HTMLElement | null) => void {
  const store = useEditorStore();
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const run = useCommandRunner(noShortcuts);
  return useCallback(
    (e, clipId, returnFocus) => {
      e.preventDefault();
      if (!menu) return;
      const { selection, select } = store.getState();
      if (!selection.clipIds.includes(clipId)) select([clipId]);
      const state = store.getState();
      const entries = rightClickEntries(clipMenu(state), state.canEdit);
      if (entries.length === 0) return;
      menu({
        ...menuPoint(e),
        label: "Clip actions",
        items: toItems(entries),
        returnFocus,
        onSelect: (id) => {
          if (id === "reset-crop") return resetCrop(store, clipId);
          const command = entries.find((entry) => entry.id === id)?.command;
          if (command) run(command);
        },
      });
    },
    [store, menu, toItems, run],
  );
}
