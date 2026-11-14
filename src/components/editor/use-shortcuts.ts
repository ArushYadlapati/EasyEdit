"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { runCommand } from "@/lib/editor/run-command";
import { keyHint, matchKeys } from "@/lib/editor/keymap";
import { SHORTCUTS, isPressable, shouldIgnoreKey, type CommandId } from "@/lib/editor/shortcuts";
import { useClipboard, useEditorStore, useSettings, useSettingsStore } from "./context";

const isMacPlatform = () => navigator.platform.startsWith("Mac");
const noChanges = () => () => {};

// The width at which EditorScreen shows the editor (Tailwind's lg). Below it a message takes its
// place, so a key would change things nobody can see.
const WIDE_ENOUGH = "(min-width: 64rem)";

const REPEATING = new Set(SHORTCUTS.filter((s) => s.repeats).map((s) => s.command));

// A field the person types into: every key there is the browser's.
const typedInto = (target: Element | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

// Whether shortcuts read Cmd (a Mac) or Ctrl. The server cannot know, so its render says Ctrl and
// the browser corrects it after hydration.
export function useIsMac(): boolean {
  return useSyncExternalStore(noChanges, isMacPlatform, () => false);
}

// A command's key for a tooltip or a menu, from the keys chosen in this browser: "" when the command
// has no key, is switched off, or every shortcut is. The keymap loads after mount, so the server's
// HTML and hydration show the table's keys.
export function useShortcutLabel(): (command: CommandId) => string {
  const isMac = useIsMac();
  const keymap = useSettings((s) => s.keymap);
  return useCallback((command: CommandId) => keyHint(command, isMac, keymap), [isMac, keymap]);
}

// Focus that arrives this soon after a pointer went down came from that click (or from what the
// click did, such as a menu handing focus back to its button).
const CLICK_FOCUS_MS = 1000;

// Text selected on the page, which Cmd/Ctrl+C and X should copy as usual.
function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

// Runs one command of the shortcut table, from a key or a menu. This is the one place the commands'
// context is built. Pass a stable openShortcuts and openExport: a new one makes a new runner.
export function useCommandRunner(openShortcuts: () => void, openExport?: () => void): (command: CommandId) => void {
  const store = useEditorStore();
  const clipboard = useClipboard();
  return useCallback(
    (command: CommandId) => runCommand(command, { store, clipboard, openShortcuts, openExport }),
    [store, clipboard, openShortcuts, openExport],
  );
}

// Runs the shortcut table's commands from key presses anywhere in the window. A key is left alone
// when a control already handled it, when it is typed into a field or presses a focused button,
// while the window is too narrow for the editor, and while a dialog or a menu is open; the export
// key is still taken from the browser then, though it runs nothing. Space plays
// or pauses even on a button, unless the button was reached with the keyboard. Copy and cut
// are left to the browser when no clip is selected or text is. A held key runs its command again
// only where the table says it repeats. The keys are this browser's keymap, read as each key goes
// down; with every shortcut off the browser gets every key. Pass a stable openShortcuts and openExport:
// a new one adds the listener again.
export function useShortcuts(openShortcuts: () => void, openExport?: () => void): void {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const run = useCommandRunner(openShortcuts, openExport);

  useEffect(() => {
    const isMac = isMacPlatform();
    // The control the pointer last focused or pressed, until the keyboard moves focus. The browser's
    // own :focus-visible cannot say this at key time: it switches on as soon as any key goes down.
    let clickedControl: Element | null = null;
    let pointerDownAt = Number.NEGATIVE_INFINITY;
    function onPointerDown(event: PointerEvent) {
      pointerDownAt = performance.now();
      // Pressing a control that already has focus moves no focus, so note it here.
      clickedControl = event.target instanceof Element && event.target === document.activeElement ? event.target : null;
    }
    function onFocusIn(event: FocusEvent) {
      const byPointer = performance.now() - pointerDownAt < CLICK_FOCUS_MS;
      clickedControl = byPointer && event.target instanceof Element ? event.target : null;
    }
    function onKeyDown(event: KeyboardEvent) {
      const { keymap } = settings.getState();
      if (!keymap.on) return;
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      // The export key is taken while a dialog or a menu is open too, so a second press never reaches the browser. It runs
      // nothing there. In a field it stays the browser's, as every key does.
      if (document.querySelector('dialog[open], [role="menu"]') && !typedInto(target) && matchKeys(event, isMac, keymap) === "export") {
        event.preventDefault();
        return;
      }
      // A button, link or summary focused by a click: Space is the shortcut, not a second press.
      const clicked =
        event.key === " " && target instanceof HTMLElement && isPressable(target) && target === clickedControl ? target : null;
      if (!clicked && shouldIgnoreKey(event, target)) return;
      if (!window.matchMedia(WIDE_ENOUGH).matches) return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      const command = matchKeys(event, isMac, keymap);
      if (!command) return;
      if ((command === "copy" || command === "cut") && (store.getState().selection.clipIds.length === 0 || hasTextSelection())) return;
      event.preventDefault();
      // Focus leaves the control, so letting go of Space cannot press it.
      clicked?.blur();
      if (event.repeat && !REPEATING.has(command)) return;
      run(command);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  }, [store, settings, run]);
}
