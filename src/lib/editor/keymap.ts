import { SHORTCUTS, keyLabel, type CommandId, type KeyLike } from "./shortcuts";

// The keys a person has chosen, on top of the table in shortcuts.ts. `keys` holds only the commands
// whose keys differ from the table's; `off` lists commands switched off one by one, which keep their
// keys; `on` false turns every shortcut off. Keys are written in the table's notation.
export type Keymap = { on: boolean; keys: Partial<Record<CommandId, string[]>>; off: CommandId[] };

export const DEFAULT_KEYMAP: Readonly<Keymap> = Object.freeze({
  on: true,
  keys: Object.freeze({}),
  off: Object.freeze([]) as unknown as CommandId[],
});

export const KEYMAP_KEY = "easyedit.keymap";

export const REFUSED = {
  macControl: "On a Mac, use ⌘ instead of Control.",
  windowsKey: "The Windows key can't be part of a shortcut.",
  moves: "That key moves focus or presses buttons. Pick another key.",
  menus: "That key opens menus. Pick another key.",
  browser: "That key belongs to the browser. Pick another key.",
};

const COMMANDS = new Set<string>(SHORTCUTS.map((s) => s.command));
const DEFAULTS = new Map<CommandId, string[]>(SHORTCUTS.map((s) => [s.command, s.keys]));

// Keys that only change what the next key does, and keys a press reports before it is finished.
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "OS"]);
const UNFINISHED_KEYS = new Set(["Dead", "Process", "Unidentified"]);

// A key as the table writes it: Space for the space bar, a single character upper-cased, named keys
// as they are.
function tableKey(key: string): string {
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

// Shift is part of typing a symbol (?, +, !), so it is kept only on letters, digits and named keys.
function keepsShift(key: string): boolean {
  return key.length !== 1 || /^[A-Z0-9]$/.test(key);
}

function join(mod: boolean, alt: boolean, shift: boolean, key: string): string {
  return [mod && "Mod", alt && "Alt", shift && keepsShift(key) && "Shift", key].filter((part) => part !== false).join("+");
}

type Parsed = { mod: boolean; alt: boolean; shift: boolean; key: string };

// Split on "+", except that a string ending in "+" has "+" as its key ("+", "Mod++"). Modifiers are
// read in any order and case; null when one is not Mod, Alt or Shift, or there is no key.
function parse(keys: string): Parsed | null {
  const plusKey = keys.endsWith("+");
  const parts = (plusKey ? keys.slice(0, -1) : keys).split("+").filter((part) => part !== "");
  const key = plusKey ? "+" : parts.pop();
  if (!key) return null;
  const mods = parts.map((part) => part.toLowerCase());
  if (mods.some((m) => m !== "mod" && m !== "alt" && m !== "shift")) return null;
  return { mod: mods.includes("mod"), alt: mods.includes("alt"), shift: mods.includes("shift"), key: tableKey(key) };
}

// A key string in the table's notation: Mod, Alt, Shift in that order, then the key. "" when it
// cannot be read.
export function canonical(keys: string): string {
  const parsed = parse(keys);
  return parsed ? join(parsed.mod, parsed.alt, parsed.shift, parsed.key) : "";
}

// How a press reads in the table's notation, or null when it is no shortcut: the other control key
// (Ctrl on a Mac, the Windows key elsewhere) is down, or the key is a bare modifier or unfinished.
export function comboOf(event: KeyLike, isMac: boolean): string | null {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const other = isMac ? event.ctrlKey : event.metaKey;
  if (other) return null;
  // Option+S on a Mac reports "ß" and Option+E a dead key, so with Alt down a letter or digit is read
  // from the key's place on the keyboard.
  const placed = event.altKey ? /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? "") : null;
  if (placed) return join(mod, true, event.shiftKey, placed[1] ?? placed[2]);
  if (MODIFIER_KEYS.has(event.key) || UNFINISHED_KEYS.has(event.key)) return null;
  return join(mod, event.altKey, event.shiftKey, tableKey(event.key));
}

const MOVES = new Set(["Tab", "Shift+Tab", "Enter", "Shift+Enter"]);
const MENUS = new Set(["Shift+F10"]);
const BROWSER = new Set([
  "Mod+W", "Mod+Shift+W", "Mod+T", "Mod+Shift+T", "Mod+N", "Mod+Shift+N", "Mod+Q", "Mod+R", "Mod+Shift+R", "Mod+L", "Mod+H", "Mod+M",
  "Mod+Tab", "Mod+Shift+Tab", ..."0123456789".split("").map((digit) => `Mod+${digit}`), "Mod+=", "Mod+-", "Mod++",
  "Mod+Shift+I", "Mod+Shift+J", "Mod+Shift+C", "Mod+Alt+I",
  "F1", "F5", "F6", "F7", "F10", "F11", "F12", "Alt+F4",
]);

// Why a key can't be a shortcut, or null. Escape with or without modifiers, Tab and Enter move focus
// or press buttons; Shift+F10 and the menu key open menus; the rest belong to the browser or the
// system. The same keys are refused on a Mac and elsewhere.
export const refusalFor: (combo: string, isMac: boolean) => string | null = (combo) => {
  const keys = canonical(combo);
  const key = parse(keys)?.key;
  if (key === "Escape" || MOVES.has(keys)) return REFUSED.moves;
  if (key === "ContextMenu" || MENUS.has(keys)) return REFUSED.menus;
  if (BROWSER.has(keys)) return REFUSED.browser;
  return null;
};

export type Recorded = { combo: string } | { refused: string } | null;

// What a press means while a key is being recorded: null keeps waiting (a repeat, a key still being
// composed, a bare modifier or an unfinished key), else the key or the reason it is refused.
export function recordKey(event: KeyLike & { repeat?: boolean; isComposing?: boolean }, isMac: boolean): Recorded {
  if (event.repeat || event.isComposing || MODIFIER_KEYS.has(event.key)) return null;
  if (isMac && event.ctrlKey) return { refused: REFUSED.macControl };
  if (!isMac && event.metaKey) return { refused: REFUSED.windowsKey };
  const combo = comboOf(event, isMac);
  if (combo === null) return null;
  const refused = refusalFor(combo, isMac);
  return refused ? { refused } : { combo };
}

// Every command's keys. A command with an entry in `keys` has those; every other command has its
// table keys minus any key an entry holds, so no key is on two commands and a chosen key wins over a
// default another command gains later. An off command keeps its keys here.
export function effectiveKeys(keymap: Keymap): Record<CommandId, string[]> {
  const taken = new Set(Object.values(keymap.keys).flat());
  const result = {} as Record<CommandId, string[]>;
  for (const { command, keys } of SHORTCUTS) {
    result[command] = keymap.keys[command] ?? keys.filter((k) => !taken.has(k));
  }
  return result;
}

// The other command that holds a key, off or not, or null.
export function conflictFor(keymap: Keymap, command: CommandId, combo: string): CommandId | null {
  const keys = canonical(combo);
  const effective = effectiveKeys(keymap);
  return SHORTCUTS.find((s) => s.command !== command && effective[s.command].includes(keys))?.command ?? null;
}

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

// Keeps only the entries that differ from the table.
function withoutDefaults(keys: Keymap["keys"]): Keymap["keys"] {
  const result: Keymap["keys"] = {};
  for (const [command, list] of Object.entries(keys) as [CommandId, string[]][]) {
    if (!sameKeys(list, DEFAULTS.get(command) ?? [])) result[command] = list;
  }
  return result;
}

// Gives a command one key in place of all its keys. `takeFrom`, the command that held the key, keeps
// its other keys.
export function setKeys(keymap: Keymap, command: CommandId, combo: string, takeFrom?: CommandId): Keymap {
  const keys: Keymap["keys"] = { ...keymap.keys, [command]: [combo] };
  if (takeFrom && takeFrom !== command) keys[takeFrom] = effectiveKeys(keymap)[takeFrom].filter((k) => k !== combo);
  return { ...keymap, keys: withoutDefaults(keys) };
}

export function setOff(keymap: Keymap, command: CommandId, off: boolean): Keymap {
  const rest = keymap.off.filter((c) => c !== command);
  return { ...keymap, off: off ? [...rest, command] : rest };
}

// The table's keys, every command on, with the switch for all of them kept.
export function resetKeys(keymap: Keymap): Keymap {
  return { on: keymap.on, keys: {}, off: [] };
}

export function isDefaultKeys(keymap: Keymap): boolean {
  return Object.keys(keymap.keys).length === 0 && keymap.off.length === 0;
}

const compiled = new WeakMap<Keymap, Map<string, CommandId>>();

// Each key and the command it runs, leaving out commands that are off. Built once per keymap object.
function compile(keymap: Keymap): Map<string, CommandId> {
  let map = compiled.get(keymap);
  if (!map) {
    map = new Map();
    const effective = effectiveKeys(keymap);
    for (const { command } of SHORTCUTS) {
      if (keymap.off.includes(command)) continue;
      for (const k of effective[command]) if (!map.has(k)) map.set(k, command);
    }
    compiled.set(keymap, map);
  }
  return map;
}

// The command a press runs, or null: always null with every shortcut off.
export function matchKeys(event: KeyLike, isMac: boolean, keymap: Keymap): CommandId | null {
  if (!keymap.on) return null;
  const combo = comboOf(event, isMac);
  return combo === null ? null : (compile(keymap).get(combo) ?? null);
}

// The command's key for a hint, as shortcutFor picks it: the first, or a Backspace key first on a
// Mac, where that key is marked delete. "" with every shortcut off, this one off, or no key.
export function keyHint(command: CommandId, isMac: boolean, keymap: Keymap): string {
  if (!keymap.on || keymap.off.includes(command)) return "";
  const keys = effectiveKeys(keymap)[command];
  const pick = (isMac && keys.find((k) => parse(k)?.key === "Backspace")) || keys[0];
  return pick ? keyLabel(pick, isMac) : "";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A keymap from storage. Anything unreadable, or of another version, gives the default. Unknown
// commands, keys that can't be read or are refused, and entries equal to the table are dropped; when
// two commands claim one key, the earlier in the table keeps it. An entry left with no key by those
// drops is dropped too, so the command goes back to its table keys; an entry stored empty stays empty.
export function parseKeymap(raw: string | null): Keymap {
  if (raw === null) return DEFAULT_KEYMAP;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_KEYMAP;
  }
  if (!isRecord(data) || data.v !== 1) return DEFAULT_KEYMAP;

  const stored = isRecord(data.keys) ? data.keys : {};
  const claimed = new Set<string>();
  const keys: Keymap["keys"] = {};
  for (const { command } of SHORTCUTS) {
    const list = Object.hasOwn(stored, command) ? stored[command] : undefined;
    if (!Array.isArray(list)) continue;
    const kept: string[] = [];
    for (const item of list) {
      const k = typeof item === "string" ? canonical(item) : "";
      if (k === "" || claimed.has(k) || refusalFor(k, false) !== null) continue;
      claimed.add(k);
      kept.push(k);
    }
    if (kept.length > 0 || list.length === 0) keys[command] = kept;
  }

  const off = Array.isArray(data.off)
    ? [...new Set(data.off.filter((c): c is CommandId => typeof c === "string" && COMMANDS.has(c)))]
    : [];
  return { on: typeof data.on === "boolean" ? data.on : true, keys: withoutDefaults(keys), off };
}

export function formatKeymap(keymap: Keymap): string {
  return JSON.stringify({ v: 1, on: keymap.on, keys: keymap.keys, off: keymap.off });
}
