import { DEFAULT_KEYMAP, KEYMAP_KEY, formatKeymap, parseKeymap, type Keymap } from "@/lib/editor/keymap";
import { LAYOUT_COOKIE, formatLayout, type Layout } from "@/lib/editor/layout";
import { PREFS_COOKIE } from "@/lib/editor/settings";

const YEAR_SECONDS = 31_536_000;

// Every space page under /s gets these cookies, the editor (/s/<slug>/editor/<id>) included, so API requests do not
// carry them. A browser that refuses cookies keeps the
// values for this page only.
function writeEditorCookie(name: string, value: string): void {
  try {
    document.cookie = `${name}=${value}; path=/s; max-age=${YEAR_SECONDS}; samesite=lax`;
  } catch {
    // Cookies are blocked here.
  }
}

// Keeps the panel sizes in this browser for every editor page under /s, where the server reads them before it paints.
export function writeLayoutCookie(layout: Layout): void {
  writeEditorCookie(LAYOUT_COOKIE, formatLayout(layout));
}

// Keeps the preferences' text (formatPrefs) in this browser for every editor page under /s, as the panel sizes are.
export function writePrefsCookie(text: string): void {
  writeEditorCookie(PREFS_COOKIE, text);
}

// One cookie's value as this page sees it now, or null when it is not there or cookies are blocked.
export function readCookie(name: string): string | null {
  try {
    for (const pair of document.cookie.split(";")) {
      const at = pair.indexOf("=");
      if (at >= 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
    }
  } catch {
    // Cookies are blocked here.
  }
  return null;
}

// The keymap kept in this browser, or the default when there is none or storage is blocked.
export function readKeymap(storage: { getItem(key: string): string | null }): Keymap {
  try {
    return parseKeymap(storage.getItem(KEYMAP_KEY));
  } catch {
    return DEFAULT_KEYMAP;
  }
}

// A refused write keeps the keymap in memory for this tab only.
export function writeKeymap(storage: { setItem(key: string, value: string): void }, keymap: Keymap): void {
  try {
    storage.setItem(KEYMAP_KEY, formatKeymap(keymap));
  } catch {
    // Storage is blocked or full.
  }
}
