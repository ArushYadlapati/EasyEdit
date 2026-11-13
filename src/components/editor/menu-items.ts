import type { MenuItem } from "@/components/ui/menu";
import type { MenuEntry } from "@/lib/editor/menus";
import { shortcutFor } from "@/lib/editor/shortcuts";

// Menu entries as the Menu draws them: an entry that runs a command shows that command's key.
export function toMenuItems(entries: MenuEntry[], isMac: boolean): MenuItem[] {
  return entries.map(({ command, ...item }) => {
    const shortcut = command ? shortcutFor(command, isMac) : "";
    return shortcut ? { ...item, shortcut } : item;
  });
}
