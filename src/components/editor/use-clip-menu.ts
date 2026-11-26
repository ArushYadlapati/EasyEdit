"use client";

import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { armCrop, editTextInPlace, nestSelection, resetCrop, unnestSelection } from "@/lib/editor/actions";
import { clipMenu, rightClickEntries } from "@/lib/editor/menus";
import { useEditorStore } from "./context";
import { useToMenuItems } from "./menu-items";
import { useCommandRunner, useIsMac } from "./use-shortcuts";

// No right-click menu offers "Keyboard shortcuts", so its commands never open them.
const noShortcuts = () => {};

// Opens a clip's menu where it was right-clicked: the timeline's clips, and the preview's. The right-click
// selects the clip unless it is already selected (it is never toggled), and the menu is built for that
// selection. A pick runs its command as its key would; Edit text, Crop and Reset crop, which have no key, act on the
// clip right-clicked. Edit text is the keyboard's way into typing a text in place (Shift+F10 opens the menu).
// Outside a menu provider it only keeps the browser's menu shut.
export function useClipMenu(): (e: ReactMouseEvent, clipId: string, returnFocus?: HTMLElement | null) => void {
  const store = useEditorStore();
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const run = useCommandRunner(noShortcuts);
  const isMac = useIsMac();
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
          if (id === "edit-text") return editTextInPlace(store, clipId);
          if (id === "crop") return armCrop(store, clipId, isMac);
          if (id === "reset-crop") return resetCrop(store, clipId);
          if (id === "nest") return nestSelection(store);
          if (id === "unnest") return unnestSelection(store);
          const command = entries.find((entry) => entry.id === id)?.command;
          if (command) run(command);
        },
      });
    },
    [store, menu, toItems, run, isMac],
  );
}
