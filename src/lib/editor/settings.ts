import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_KEYMAP, type Keymap } from "./keymap";
import { DEFAULT_IMAGE_SECONDS } from "./media-clips";
import { DEFAULT_TEXT_SECONDS } from "./text-presets";

// What one person chose for their own editor, kept in this browser for every project: small values in a cookie the
// server reads, so the first paint already shows them, and the keymap in local storage. Nothing here reaches the
// project or other people.

export type Units = "px" | "cm" | "in";
export type BoardZoom = "fill" | number; // a whole percent
export const BOARD_ZOOM_MIN = 10;
export const BOARD_ZOOM_MAX = 400;
export const LENGTH_MIN_S = 0.5; // a still image's or a text clip's length from Settings
export const LENGTH_MAX_S = 60;

export type Prefs = {
  units: Units;
  safeZones: boolean;
  snapping: boolean;
  boardZoom: BoardZoom;
  stillSeconds: number;
  textSeconds: number;
  guides: boolean;
  meter: boolean;
};

export const PREFS_COOKIE = "easyedit-prefs";

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  units: "px",
  safeZones: false, // the safe area box starts hidden
  snapping: true,
  boardZoom: "fill",
  stillSeconds: DEFAULT_IMAGE_SECONDS,
  textSeconds: DEFAULT_TEXT_SECONDS,
  guides: true, // a project's guides show until this browser hides them
  meter: true, // the audio meter beside the timeline shows until this browser hides it
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function clampPercent(n: number): number {
  return clamp(Math.round(n), BOARD_ZOOM_MIN, BOARD_ZOOM_MAX);
}

export function clampSeconds(n: number): number {
  return clamp(Math.round(n * 10) / 10, LENGTH_MIN_S, LENGTH_MAX_S);
}

const UNITS: readonly string[] = ["px", "cm", "in"] satisfies Units[];
const WHOLE = /^\d{1,6}$/;
const tenths = (seconds: number) => Math.round(clampSeconds(seconds) * 10);
const flag = (on: boolean) => (on ? "1" : "0");

// The cookie's text, for example "u:px.sz:1.sn:1.z:fill.st:30.tx:30": named fields, so a later field can be added
// without resetting the others. Lengths are in tenths of a second. Only [a-z0-9:.], so the browser and the server
// read the same value with no encoding.
export function formatPrefs(p: Prefs): string {
  const zoom = p.boardZoom === "fill" ? "fill" : clampPercent(p.boardZoom);
  return `u:${p.units}.sz:${flag(p.safeZones)}.sn:${flag(p.snapping)}.z:${zoom}.st:${tenths(p.stillSeconds)}.tx:${tenths(p.textSeconds)}.gd:${flag(p.guides)}.am:${flag(p.meter)}`;
}

// Field by field: an unknown field is ignored, and a missing or bad one takes its default.
export function parsePrefs(text: string | null | undefined): Prefs {
  const prefs: Prefs = { ...DEFAULT_PREFS };
  for (const pair of (text ?? "").split(".")) {
    const colon = pair.indexOf(":");
    if (colon < 0) continue;
    const key = pair.slice(0, colon);
    const value = pair.slice(colon + 1);
    const isFlag = value === "0" || value === "1";
    if (key === "u" && UNITS.includes(value)) prefs.units = value as Units;
    else if (key === "sz" && isFlag) prefs.safeZones = value === "1";
    else if (key === "sn" && isFlag) prefs.snapping = value === "1";
    else if (key === "gd" && isFlag) prefs.guides = value === "1";
    else if (key === "am" && isFlag) prefs.meter = value === "1";
    else if (key === "z" && value === "fill") prefs.boardZoom = "fill";
    else if (key === "z" && WHOLE.test(value)) prefs.boardZoom = clampPercent(Number(value));
    else if (key === "st" && WHOLE.test(value)) prefs.stillSeconds = clampSeconds(Number(value) / 10);
    else if (key === "tx" && WHOLE.test(value)) prefs.textSeconds = clampSeconds(Number(value) / 10);
  }
  return prefs;
}

type Saved = "units" | "boardZoom" | "stillSeconds" | "textSeconds";
const SAVED: readonly Saved[] = ["units", "boardZoom", "stillSeconds", "textSeconds"];

export type SettingsState = {
  units: Units;
  boardZoom: BoardZoom;
  lockAspect: boolean; // the inspector's "Lock aspect ratio": on at every page load, never saved
  stillSeconds: number;
  textSeconds: number;
  keymap: Keymap;
  // Saves the prefs when a saved field changes; lockAspect is memory only.
  set(patch: Partial<Pick<SettingsState, "units" | "boardZoom" | "lockAspect" | "stillSeconds" | "textSeconds">>): void;
  setKeymap(keymap: Keymap): void; // saves the keymap
  loadKeymap(keymap: Keymap): void; // from storage after mount; saves nothing
};
export type SettingsStore = StoreApi<SettingsState>;

// Snapping and the safe area, guide and audio meter switches live in the editor store, so the caller adds them when
// it writes the cookie.
export type SettingsSave = { prefs(p: Omit<Prefs, "snapping" | "safeZones" | "guides" | "meter">): void; keymap(k: Keymap): void };

// Without a saver, as in tests, every choice is kept in memory only.
export function createSettingsStore(initial: { prefs: Prefs; keymap?: Keymap }, save?: SettingsSave): SettingsStore {
  const { units, boardZoom, stillSeconds, textSeconds } = initial.prefs;
  return createStore<SettingsState>()((setState, get) => ({
    units,
    boardZoom,
    lockAspect: true,
    stillSeconds,
    textSeconds,
    keymap: initial.keymap ?? DEFAULT_KEYMAP,
    set(patch) {
      const before = get();
      setState(patch);
      const now = get();
      if (SAVED.some((field) => now[field] !== before[field])) {
        save?.prefs({ units: now.units, boardZoom: now.boardZoom, stillSeconds: now.stillSeconds, textSeconds: now.textSeconds });
      }
    },
    setKeymap(keymap) {
      setState({ keymap });
      save?.keymap(keymap);
    },
    loadKeymap(keymap) {
      setState({ keymap });
    },
  }));
}
