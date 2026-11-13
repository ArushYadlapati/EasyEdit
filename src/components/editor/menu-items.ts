"use client";

import { useCallback } from "react";
import type { MenuItem } from "@/components/ui/menu";
import { DEFAULT_KEYMAP, keyHint, type Keymap } from "@/lib/editor/keymap";
import type { MenuEntry } from "@/lib/editor/menus";
import { useSettingsStore } from "./context";
import { useIsMac } from "./use-shortcuts";

// Menu entries as the Menu draws them: an entry that runs a command shows that command's key in the
// keymap, the table's keys when none is given.
export function toMenuItems(entries: MenuEntry[], isMac: boolean, keymap?: Keymap): MenuItem[] {
  return entries.map(({ command, ...item }) => {
    const shortcut = command ? keyHint(command, isMac, keymap ?? DEFAULT_KEYMAP) : "";
    return shortcut ? { ...item, shortcut } : item;
  });
}

// toMenuItems with this browser's keys, read when a menu opens.
export function useToMenuItems(): (entries: MenuEntry[]) => MenuItem[] {
  const isMac = useIsMac();
  const settings = useSettingsStore();
  return useCallback((entries: MenuEntry[]) => toMenuItems(entries, isMac, settings.getState().keymap), [isMac, settings]);
}
