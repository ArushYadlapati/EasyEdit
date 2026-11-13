import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYMAP,
  KEYMAP_KEY,
  REFUSED,
  canonical,
  comboOf,
  conflictFor,
  effectiveKeys,
  formatKeymap,
  isDefaultKeys,
  keyHint,
  matchKeys,
  parseKeymap,
  recordKey,
  refusalFor,
  resetKeys,
  setKeys,
  setOff,
  type Keymap,
} from "@/lib/editor/keymap";
import { SHORTCUTS, matchShortcut, shortcutFor, type KeyLike } from "@/lib/editor/shortcuts";

type Press = KeyLike & { repeat?: boolean; isComposing?: boolean };
const key = (k: string, mods: Partial<Press> = {}): Press => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const MAC = true;
const PC = false;

// A key string from the table as a press: Mod is Ctrl on a PC and Cmd on a Mac, and ? and + are typed
// with Shift down.
function pressOf(keys: string, isMac: boolean): Press {
  const plusKey = keys.endsWith("+");
  const parts = (plusKey ? keys.slice(0, -1) : keys).split("+").filter((p) => p !== "");
  const name = plusKey ? "+" : (parts.pop() ?? "");
  const mod = parts.includes("Mod");
  const k = name === "Space" ? " " : name.length === 1 ? name.toLowerCase() : name;
  return key(k, {
    metaKey: isMac && mod,
    ctrlKey: !isMac && mod,
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift") || name === "?" || name === "+",
  });
}

describe("reading keys", () => {
  it("canonical orders the modifiers and cases the key", () => {
    expect(canonical("shift+mod+s")).toBe("Mod+Shift+S");
    expect(canonical("Alt+ArrowLeft")).toBe("Alt+ArrowLeft");
    expect(canonical("Shift+Alt+Mod+z")).toBe("Mod+Alt+Shift+Z");
    expect(canonical("Mod++")).toBe("Mod++");
    expect(canonical("Shift+?")).toBe("?");
  });

  it("comboOf reads a press as the table writes it", () => {
    expect(comboOf(key("s", { ctrlKey: true, shiftKey: true }), PC)).toBe("Mod+Shift+S");
    expect(comboOf(key(" "), PC)).toBe("Space");
    expect(comboOf(key(" ", { shiftKey: true }), PC)).toBe("Shift+Space");
    expect(comboOf(key("?", { shiftKey: true }), PC)).toBe("?");
    expect(comboOf(key("ß", { code: "KeyS", altKey: true }), MAC)).toBe("Alt+S");
    expect(comboOf(key("Dead", { code: "KeyE", altKey: true }), MAC)).toBe("Alt+E");
    expect(comboOf(key("Dead", { code: "Quote" }), MAC)).toBeNull();
    expect(comboOf(key("s", { ctrlKey: true }), MAC)).toBeNull();
    expect(comboOf(key("s", { metaKey: true }), PC)).toBeNull();
    expect(comboOf(key("Shift", { shiftKey: true }), PC)).toBeNull();
  });

  it("comboOf keeps Shift on letters and digits, and Mod is Cmd on a Mac", () => {
    expect(comboOf(key("S", { shiftKey: true }), PC)).toBe("Shift+S");
    expect(comboOf(key("s"), PC)).toBe("S");
    expect(comboOf(key("z", { metaKey: true, shiftKey: true }), MAC)).toBe("Mod+Shift+Z");
    expect(comboOf(key("¡", { code: "Digit1", altKey: true }), MAC)).toBe("Alt+1");
    expect(comboOf(key("ArrowLeft", { altKey: true, shiftKey: true }), PC)).toBe("Alt+Shift+ArrowLeft");
    for (const name of ["Control", "Alt", "Meta", "CapsLock", "Fn", "OS", "Process", "Unidentified"]) {
      expect(comboOf(key(name), PC), name).toBeNull();
    }
  });

  it("recordKey refuses keys with a reason", () => {
    expect(recordKey(key("Shift", { shiftKey: true }), PC)).toBeNull();
    expect(recordKey(key("Control", { ctrlKey: true }), MAC)).toBeNull();
    expect(recordKey(key("s", { repeat: true }), PC)).toBeNull();
    expect(recordKey(key("s", { isComposing: true }), PC)).toBeNull();
    expect(recordKey(key("s", { ctrlKey: true }), MAC)).toEqual({ refused: "On a Mac, use ⌘ instead of Control." });
    expect(recordKey(key("s", { metaKey: true }), PC)).toEqual({ refused: "The Windows key can't be part of a shortcut." });
    expect(recordKey(key("r", { ctrlKey: true }), PC)).toEqual({ refused: "That key belongs to the browser. Pick another key." });
    expect(recordKey(key("F5"), PC)).toEqual({ refused: "That key belongs to the browser. Pick another key." });
    expect(recordKey(key("PageDown", { ctrlKey: true }), PC)).toEqual({ refused: "That key belongs to the browser. Pick another key." });
    expect(recordKey(key("F10", { shiftKey: true }), PC)).toEqual({ refused: REFUSED.menus });
    expect(recordKey(key("Enter"), PC)).toEqual({ refused: REFUSED.moves });
    expect(recordKey(key("Tab", { shiftKey: true }), PC)).toEqual({ refused: REFUSED.moves });
    expect(recordKey(key("s", { ctrlKey: true, shiftKey: true }), PC)).toEqual({ combo: "Mod+Shift+S" });
    expect(recordKey(key("d", { ctrlKey: true }), PC)).toEqual({ combo: "Mod+D" });
  });

  it("recordKey waits for a key a dead key or an IME has not finished", () => {
    expect(recordKey(key("Dead", { code: "Quote" }), MAC)).toBeNull();
    expect(recordKey(key("Process"), PC)).toBeNull();
    expect(recordKey(key("Dead", { code: "KeyE", altKey: true }), MAC)).toEqual({ combo: "Alt+E" });
  });

  it("refusalFor names every refused key and its reason", () => {
    expect(REFUSED).toEqual({
      macControl: "On a Mac, use ⌘ instead of Control.",
      windowsKey: "The Windows key can't be part of a shortcut.",
      moves: "That key moves focus or presses buttons. Pick another key.",
      menus: "That key opens menus. Pick another key.",
      browser: "That key belongs to the browser. Pick another key.",
    });
    expect(refusalFor("Escape", false)).toBe(REFUSED.moves);
    for (const combo of ["Tab", "Shift+Tab", "Escape", "Shift+Escape", "Mod+Escape", "Alt+Escape", "Enter", "Shift+Enter"]) {
      expect(refusalFor(combo, false), combo).toBe(REFUSED.moves);
    }
    for (const combo of ["Shift+F10", "ContextMenu", "Shift+ContextMenu"]) {
      expect(refusalFor(combo, false), combo).toBe(REFUSED.menus);
    }
    const browser = [
      "Mod+W", "Mod+Shift+W", "Mod+T", "Mod+Shift+T", "Mod+N", "Mod+Shift+N", "Mod+Q", "Mod+R", "Mod+Shift+R", "Mod+L", "Mod+H", "Mod+M",
      "Mod+Tab", "Mod+Shift+Tab", "Mod+0", "Mod+1", "Mod+2", "Mod+3", "Mod+4", "Mod+5", "Mod+6", "Mod+7", "Mod+8", "Mod+9",
      "Mod+=", "Mod+-", "Mod++", "Mod+Shift+I", "Mod+Shift+J", "Mod+Shift+C", "Mod+Alt+I",
      "F1", "F5", "F6", "F7", "F10", "F11", "F12", "Alt+F4", "Mod+PageUp", "Mod+PageDown", "Mod+F4",
    ];
    for (const combo of browser) {
      expect(refusalFor(combo, false), combo).toBe(REFUSED.browser);
      expect(refusalFor(combo, true), combo).toBe(REFUSED.browser);
    }
    for (const combo of ["Mod+D", "Mod+E", "Mod+S", "Mod+P", "Mod+F", "Space", "S", "1", "?", "ArrowLeft", "Alt+ArrowLeft", "Home", "Delete", "Backspace", "Mod+Enter", "F2", "Shift+F5"]) {
      expect(refusalFor(combo, false), combo).toBeNull();
    }
  });
});

describe("the keymap", () => {
  it("a custom key wins over another command's default", () => {
    const keys = effectiveKeys({ on: true, keys: { split: ["Mod+C"] }, off: [] });
    expect(keys.split).toEqual(["Mod+C"]);
    expect(keys.copy).toEqual([]);
    for (const s of SHORTCUTS) {
      if (s.command !== "split" && s.command !== "copy") expect(keys[s.command], s.command).toEqual(s.keys);
    }
  });

  it("conflictFor finds who holds a key, even when it is off", () => {
    const km: Keymap = { on: true, keys: {}, off: [] };
    expect(conflictFor(km, "split", "N")).toBe("toggle-snapping");
    expect(conflictFor({ ...km, off: ["toggle-snapping"] }, "split", "N")).toBe("toggle-snapping");
    expect(conflictFor(km, "split", "S")).toBeNull();
    expect(conflictFor({ on: true, keys: { copy: ["N"] }, off: [] }, "split", "N")).toBe("copy");
  });

  it("setKeys takes the key from the other command", () => {
    const taken = setKeys(DEFAULT_KEYMAP, "split", "N", "toggle-snapping");
    expect(taken.keys).toEqual({ split: ["N"], "toggle-snapping": [] });
    expect(setKeys(taken, "split", "S").keys).toEqual({ "toggle-snapping": [] });
  });

  it("setKeys replaces every key of a command, and the taken one keeps its others", () => {
    const km = setKeys(DEFAULT_KEYMAP, "undo", "Mod+Y", "redo");
    expect(km.keys).toEqual({ undo: ["Mod+Y"], redo: ["Mod+Shift+Z"] });
    expect(setKeys(km, "delete", "D").keys.delete).toEqual(["D"]);
    expect(DEFAULT_KEYMAP).toEqual({ on: true, keys: {}, off: [] });
  });

  it("setOff turns one command off and on again", () => {
    const off = setOff(DEFAULT_KEYMAP, "split", true);
    expect(off.off).toEqual(["split"]);
    expect(setOff(off, "split", true).off).toEqual(["split"]);
    expect(setOff(off, "split", false).off).toEqual([]);
    expect(matchKeys(key("s"), PC, setOff(off, "split", false))).toBe("split");
  });

  it("an off command keeps its keys and neither matches nor shows", () => {
    const km = setOff(DEFAULT_KEYMAP, "split", true);
    expect(matchKeys(key("s"), PC, km)).toBeNull();
    expect(keyHint("split", PC, km)).toBe("");
    expect(effectiveKeys(km).split).toEqual(["S"]);
    expect(matchKeys(key("n"), PC, km)).toBe("toggle-snapping");
  });

  it("all off matches nothing", () => {
    const km: Keymap = { on: false, keys: {}, off: [] };
    expect(matchKeys(key("s"), PC, km)).toBeNull();
    expect(matchKeys(key(" "), PC, km)).toBeNull();
    expect(keyHint("split", PC, km)).toBe("");
    expect(keyHint("undo", MAC, km)).toBe("");
  });

  it("matches and shows a chosen key, and a command with no key shows none", () => {
    const km = setKeys(DEFAULT_KEYMAP, "split", "Mod+Shift+S");
    expect(matchKeys(key("S", { ctrlKey: true, shiftKey: true }), PC, km)).toBe("split");
    expect(matchKeys(key("s"), PC, km)).toBeNull();
    expect(keyHint("split", MAC, km)).toBe("⌘⇧S");
    expect(keyHint("split", PC, km)).toBe("Ctrl+Shift+S");
    const alt = setKeys(DEFAULT_KEYMAP, "split", "Alt+S");
    expect(matchKeys(key("ß", { code: "KeyS", altKey: true }), MAC, alt)).toBe("split");
    const none = setKeys(DEFAULT_KEYMAP, "split", "N", "toggle-snapping");
    expect(keyHint("toggle-snapping", PC, none)).toBe("");
    expect(matchKeys(key("n"), PC, none)).toBe("split");
  });

  it("resetKeys keeps the master switch", () => {
    const km = resetKeys({ on: false, keys: { split: ["N"] }, off: ["copy"] });
    expect(km).toEqual({ on: false, keys: {}, off: [] });
    expect(isDefaultKeys(km)).toBe(true);
    expect(isDefaultKeys({ on: true, keys: { split: ["N"] }, off: [] })).toBe(false);
    expect(isDefaultKeys({ on: true, keys: {}, off: ["copy"] })).toBe(false);
  });

  it("with the default keymap, matching and hints are the plain table's", () => {
    for (const isMac of [MAC, PC]) {
      for (const s of SHORTCUTS) {
        for (const k of s.keys) {
          const press = pressOf(k, isMac);
          expect(matchKeys(press, isMac, DEFAULT_KEYMAP), `${k} ${isMac}`).toBe(matchShortcut(press, isMac));
          expect(matchKeys(press, isMac, DEFAULT_KEYMAP), `${k} ${isMac}`).toBe(s.command);
        }
        expect(keyHint(s.command, isMac, DEFAULT_KEYMAP), s.command).toBe(shortcutFor(s.command, isMac));
      }
    }
  });

  it("is frozen and stored under its own name", () => {
    expect(DEFAULT_KEYMAP).toEqual({ on: true, keys: {}, off: [] });
    expect(Object.isFrozen(DEFAULT_KEYMAP)).toBe(true);
    expect(Object.isFrozen(DEFAULT_KEYMAP.keys)).toBe(true);
    expect(Object.isFrozen(DEFAULT_KEYMAP.off)).toBe(true);
    expect(KEYMAP_KEY).toBe("easyedit.keymap");
  });
});

describe("storing the keymap", () => {
  it("parseKeymap keeps only what is valid", () => {
    expect(parseKeymap("x")).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap(null)).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap('{"v":2}')).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap("[1]")).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap("3")).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap("null")).toBe(DEFAULT_KEYMAP);

    const raw = JSON.stringify({
      v: 1,
      keys: { export: ["Mod+E"], copy: ["Mod+R"], split: ["S"], undo: ["mod+u"] },
      off: ["export", "pause"],
    });
    expect(parseKeymap(raw)).toEqual({ on: true, keys: { undo: ["Mod+U"] }, off: ["pause"] });

    const twice = JSON.stringify({ v: 1, on: false, keys: { "toggle-snapping": ["Shift+Z"], split: ["N"], pause: ["N"] }, off: [] });
    expect(parseKeymap(twice)).toEqual({ on: false, keys: { pause: ["N"], "toggle-snapping": ["Shift+Z"] }, off: [] });

    const km: Keymap = { on: false, keys: { split: ["Mod+Shift+S"], "toggle-snapping": [] }, off: ["copy", "pause"] };
    expect(formatKeymap(km)).toBe('{"v":1,"on":false,"keys":{"split":["Mod+Shift+S"],"toggle-snapping":[]},"off":["copy","pause"]}');
    expect(parseKeymap(formatKeymap(km))).toEqual(km);
  });

  it("parseKeymap drops what it cannot read and keeps the invariant", () => {
    expect(parseKeymap('{"v":1,"on":"yes","keys":[],"off":"split"}')).toEqual({ on: true, keys: {}, off: [] });
    expect(parseKeymap('{"v":1,"keys":{"split":["Ctrl+S", 4, "", "Mod+K", "mod+k"]},"off":["split","split"]}')).toEqual({
      on: true,
      keys: { split: ["Mod+K"] },
      off: ["split"],
    });
    expect(parseKeymap('{"v":1,"keys":{"split":"N"}}')).toEqual({ on: true, keys: {}, off: [] });
    expect(parseKeymap('{"v":1,"keys":null,"off":null}')).toEqual({ on: true, keys: {}, off: [] });
    expect(parseKeymap('{"v":1,"keys":{"zoom-fit":[]}}')).toEqual({ on: true, keys: { "zoom-fit": [] }, off: [] });
  });
});
