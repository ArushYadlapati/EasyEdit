import { LIMITS } from "@/lib/limits";
import { BOX_SHAPES, SHAPE_TOOL_NAME, type BoxShape, type TrackKind } from "@/lib/timeline";
import type { TopMenuInput } from "./menus";
import { SHORTCUTS, type CommandId } from "./shortcuts";
import { TEXT_PRESETS } from "./text-presets";

// The top bar's search: everything a person can find by name and run from one field. Each result is data; the top bar
// runs its action.

export type SearchGroup = "Tools" | "Add" | "Edit" | "Playback" | "Timeline" | "Panels" | "Settings" | "Project";

export type SettingsPage = "project" | "general" | "shortcuts";
export type PanelSide = "left" | "right";

export type SearchAction =
  | { kind: "command"; command: CommandId }
  | { kind: "shape"; shape: BoxShape }
  | { kind: "text"; preset: string }
  | { kind: "track"; track: TrackKind }
  | { kind: "panel"; side: PanelSide; tab: string }
  | { kind: "settings"; page: SettingsPage }
  | { kind: "safe-zones" }
  | { kind: "reset-layout" }
  | { kind: "save-template" }
  | { kind: "rename" };

// command: its key is shown as the result's hint. checked: a switch, shown as on or off.
export type SearchItem = {
  id: string;
  label: string;
  group: SearchGroup;
  keywords: string[];
  action: SearchAction;
  command?: CommandId;
  disabled?: boolean;
  checked?: boolean;
};

export type PanelTab = { id: string; label: string };

// What the list needs to know besides the top menus' state: the panels' tabs, and which actions this editor offers.
export type SearchInput = TopMenuInput & {
  leftTabs: readonly PanelTab[];
  rightTabs: readonly PanelTab[];
  trackCount: number;
  hasCaptions: boolean;
  canSaveTemplate: boolean;
};

// Other words people use for a thing, so "blade" finds the Razor and "fade" the Effects tab.
const COMMAND_WORDS: Partial<Record<CommandId, string[]>> = {
  "tool-select": ["pointer", "arrow", "move", "select"],
  "tool-razor": ["cut", "blade", "split", "slice"],
  "tool-text": ["type", "title", "words", "write"],
  "tool-shape": ["draw", "rectangle", "square", "ellipse", "circle", "triangle", "star", "polygon"],
  "tool-shape-next": ["shape", "cycle", "switch"],
  "tool-line": ["draw", "shape", "stroke", "curve", "path", "underline"],
  "tool-arrow": ["draw", "shape", "pointer", "point", "curve", "path"],
  "tool-guide": ["ruler", "align", "line"],
  "tool-crop": ["trim", "frame"],
  "play-pause": ["play", "pause", "stop", "start", "preview", "watch"],
  "play-forward": ["fast", "faster", "shuttle"],
  "play-reverse": ["rewind", "reverse", "backwards", "shuttle"],
  "frame-back": ["previous", "step", "left"],
  "frame-forward": ["next", "step", "right"],
  "prev-edge": ["jump", "cut", "clip"],
  "next-edge": ["jump", "cut", "clip"],
  "go-start": ["beginning", "home", "first"],
  "go-end": ["finish", "last"],
  undo: ["revert", "back", "mistake"],
  redo: ["again", "forward"],
  split: ["cut", "slice", "razor", "blade"],
  delete: ["remove", "erase", "trash"],
  "ripple-delete": ["remove", "gap", "close"],
  copy: ["clipboard"],
  cut: ["clipboard"],
  paste: ["clipboard"],
  duplicate: ["clone", "copy"],
  "nudge-left": ["move", "shift"],
  "nudge-right": ["move", "shift"],
  "nudge-left-second": ["move", "shift"],
  "nudge-right-second": ["move", "shift"],
  "select-all": ["everything", "clips"],
  "clear-selection": ["deselect", "unselect", "none"],
  "zoom-in": ["magnify", "bigger", "timeline"],
  "zoom-out": ["smaller", "timeline"],
  "zoom-fit": ["zoom", "whole", "fit"],
  "toggle-snapping": ["snap", "magnet", "align"],
  "toggle-audio-meter": ["sound", "level", "levels", "volume", "loudness", "vu", "db", "show", "hide"],
  "volume-up": ["sound", "audio", "loud", "boost", "gain", "increase"],
  "volume-down": ["sound", "audio", "quiet", "lower", "gain", "decrease"],
  "mute-clip": ["sound", "audio", "silence", "silent", "volume"],
  "separate-audio": ["sound", "detach", "unlink", "split", "extract", "voice", "music"],
  "duck-audio": ["music", "speech", "voice", "lower", "quieter", "under", "sound", "volume", "ducking"],
  "reverse-clip": ["backward", "backwards", "rewind", "speed", "flip", "time"],
  "freeze-frame": ["hold", "still", "pause", "stop", "speed", "time"],
  export: ["render", "download", "save", "video", "mp4", "share"],
  "show-shortcuts": ["keyboard", "keys", "hotkeys", "keymap"],
};

// Shorter names than the shortcut table's, which explains each tool on its own line.
const COMMAND_LABELS: Partial<Record<CommandId, string>> = {
  "tool-select": "Selection tool",
  "tool-razor": "Razor tool",
  "tool-text": "Text tool",
  "tool-shape": "Shape tool",
  "tool-shape-next": "Next shape",
  "tool-line": "Line tool",
  "tool-arrow": "Arrow tool",
  "tool-guide": "Guide tool",
  "tool-crop": "Crop tool",
  "toggle-snapping": "Snapping",
  "toggle-audio-meter": "Audio meter",
  "volume-up": "Volume up",
  "volume-down": "Volume down",
  "mute-clip": "Mute or unmute clip",
  "separate-audio": "Separate audio",
  "duck-audio": "Duck under speech",
  "reverse-clip": "Reverse clip",
  "freeze-frame": "Freeze frame",
  "show-shortcuts": "Keyboard shortcuts",
  "zoom-in": "Zoom in on the timeline",
  "zoom-out": "Zoom out on the timeline",
};

const SHAPE_WORDS: Record<BoxShape, string[]> = {
  rect: ["square", "box"],
  ellipse: ["circle", "oval"],
  triangle: ["polygon", "wedge"],
  diamond: ["rhombus", "polygon"],
  pentagon: ["polygon", "five"],
  hexagon: ["polygon", "six"],
  star: ["favorite", "rating"],
};

const TRACKS: { kind: TrackKind; label: string }[] = [
  { kind: "video", label: "Add video track" },
  { kind: "overlay", label: "Add overlay track" },
  { kind: "text", label: "Add text track" },
  { kind: "shape", label: "Add shapes track" },
  { kind: "audio", label: "Add audio track" },
  { kind: "caption", label: "Add captions track" },
];

// The panels' tabs by id. A tab not named here (a new one) is still found by its label.
const PANEL_WORDS: Record<string, string[]> = {
  text: ["titles", "presets", "heading"],
  media: ["upload", "import", "files", "library", "video", "image", "photo", "audio", "music", "assets"],
  brand: ["brand", "colors", "colours", "fonts", "logo", "kit"],
  inspect: ["properties", "position", "size", "opacity", "volume", "details", "transform"],
  activity: ["history", "changes", "log", "who", "edits"],
  effects: ["transitions", "fade", "keyframes", "animation", "animate", "motion"],
  captions: ["subtitles", "transcribe", "transcript", "auto"],
};

const SETTINGS: { page: SettingsPage; label: string; keywords: string[] }[] = [
  {
    page: "project",
    label: "Project settings",
    keywords: ["format", "size", "resolution", "aspect", "ratio", "canvas", "dimensions", "vertical", "landscape", "safe", "area"],
  },
  {
    page: "general",
    label: "General settings",
    keywords: ["preferences", "units", "pixels", "cm", "inches", "snapping", "still", "image", "length", "duration", "text", "clip"],
  },
  { page: "shortcuts", label: "Shortcut settings", keywords: ["keyboard", "keys", "hotkeys", "keymap", "customize", "change"] },
];

// The commands each group lists, in the order the empty search shows them. Tools, Export and Keyboard shortcuts have
// groups of their own below.
const COMMAND_GROUPS: { group: SearchGroup; commands: CommandId[] }[] = [
  { group: "Tools", commands: ["tool-select", "tool-razor", "tool-text", "tool-shape", "tool-shape-next", "tool-line", "tool-arrow", "tool-guide", "tool-crop"] },
  {
    group: "Edit",
    commands: [
      "undo", "redo", "cut", "copy", "paste", "duplicate", "split", "delete", "ripple-delete",
      "nudge-left", "nudge-right", "nudge-left-second", "nudge-right-second", "select-all", "clear-selection",
      "volume-up", "volume-down", "mute-clip", "separate-audio", "duck-audio", "reverse-clip", "freeze-frame",
    ],
  },
  {
    group: "Playback",
    commands: [
      "play-pause", "play-forward", "pause", "play-reverse", "frame-back", "frame-forward", "second-back", "second-forward",
      "prev-edge", "next-edge", "go-start", "go-end",
    ],
  },
  { group: "Timeline", commands: ["zoom-in", "zoom-out", "zoom-fit", "toggle-snapping", "toggle-audio-meter"] },
];

const EDITS = new Set(SHORTCUTS.filter((s) => s.edits).map((s) => s.command));
const LABELS = new Map(SHORTCUTS.map((s) => [s.command, s.label]));

// Why a command cannot run right now, beyond being an edit nobody can make: as the Edit and View menus grey it.
function commandUnavailable(command: CommandId, input: SearchInput): boolean {
  const noSelection = !input.hasSelection;
  switch (command) {
    case "undo":
      return !input.canUndo;
    case "redo":
      return !input.canRedo;
    case "paste":
      return !input.canPaste;
    case "cut":
    case "copy":
    case "duplicate":
    case "delete":
    case "ripple-delete":
    case "nudge-left":
    case "nudge-right":
    case "nudge-left-second":
    case "nudge-right-second":
    case "volume-up":
    case "volume-down":
    case "mute-clip":
    case "separate-audio":
    case "duck-audio":
    case "reverse-clip":
    case "freeze-frame":
      return noSelection;
    case "zoom-in":
      return !input.canZoomIn;
    case "zoom-out":
      return !input.canZoomOut;
    default:
      return false;
  }
}

// Every result, in the order the empty search shows them. What cannot run right now is there but disabled: an edit
// for a viewer, in a deleted project or during a drag; Paste with nothing copied; a panel of a deleted project.
export function searchItems(input: SearchInput): SearchItem[] {
  const editBlocked = !input.canEdit || input.deleted || input.busy;
  const items: SearchItem[] = [];
  const command = (group: SearchGroup, id: CommandId, extra: Partial<SearchItem> = {}): SearchItem => ({
    id: `command:${id}`,
    label: COMMAND_LABELS[id] ?? LABELS.get(id) ?? id,
    group,
    keywords: COMMAND_WORDS[id] ?? [],
    action: { kind: "command", command: id },
    command: id,
    // A deleted project shows no preview or timeline, so nothing but Export and the shortcuts has anything to act on.
    disabled: (EDITS.has(id) && editBlocked) || input.deleted || commandUnavailable(id, input),
    ...extra,
  });

  for (const { group, commands } of COMMAND_GROUPS) {
    for (const id of commands) {
      if (id === "toggle-snapping") items.push(command(group, id, { checked: input.snapping }));
      else if (id === "toggle-audio-meter") items.push(command(group, id, { checked: input.showAudioMeter }));
      else items.push(command(group, id));
    }
    if (group === "Tools") {
      for (const shape of BOX_SHAPES) {
        items.push({
          id: `shape:${shape}`,
          label: `${SHAPE_TOOL_NAME[shape]} shape`,
          group: "Tools",
          keywords: ["shape", "draw", ...SHAPE_WORDS[shape]],
          action: { kind: "shape", shape },
          disabled: editBlocked,
        });
      }
      for (const preset of TEXT_PRESETS) {
        items.push({
          id: `text:${preset.id}`,
          label: `Add ${preset.label.toLowerCase()}`,
          group: "Add",
          keywords: ["text", "title", "type", "words", "preset"],
          action: { kind: "text", preset: preset.id },
          disabled: editBlocked,
        });
      }
      const full = input.trackCount >= LIMITS.tracksPerProject;
      for (const { kind, label } of TRACKS) {
        items.push({
          id: `track:${kind}`,
          label,
          group: "Add",
          keywords: ["track", "layer", "lane", "row", ...(kind === "caption" ? ["subtitles"] : [])],
          action: { kind: "track", track: kind },
          disabled: editBlocked || full || (kind === "caption" && input.hasCaptions),
        });
      }
    }
  }
  // This browser's own switch, so a viewer has it too.
  items.push({
    id: "safe-zones",
    label: "Safe area",
    group: "Timeline",
    keywords: ["margins", "overlay", "instagram", "tiktok", "youtube", "shorts", "reels", "ui"],
    action: { kind: "safe-zones" },
    checked: input.showSafeZones,
    disabled: input.deleted,
  });

  const panel = (side: PanelSide) => (tab: PanelTab) =>
    items.push({
      id: `panel:${side}:${tab.id}`,
      label: tab.id === "brand" ? "Brand kit" : `${tab.label} panel`,
      group: "Panels",
      keywords: ["panel", "tab", "open", "show", ...(PANEL_WORDS[tab.id] ?? [])],
      action: { kind: "panel", side, tab: tab.id },
      disabled: input.deleted,
    });
  input.leftTabs.forEach(panel("left"));
  input.rightTabs.forEach(panel("right"));
  items.push({
    id: "reset-layout",
    label: "Reset panel sizes",
    group: "Panels",
    keywords: ["layout", "panels", "default", "restore", "resize"],
    action: { kind: "reset-layout" },
  });

  for (const { page, label, keywords } of SETTINGS) {
    items.push({ id: `settings:${page}`, label, group: "Settings", keywords: ["settings", "options", ...keywords], action: { kind: "settings", page } });
  }
  items.push(command("Settings", "show-shortcuts", { disabled: false }));

  // Export guards itself as its button does: a deleted project's export opens only for a running one or a held file.
  items.push(command("Project", "export", { disabled: false }));
  items.push({
    id: "rename",
    label: "Rename project",
    group: "Project",
    keywords: ["name", "title", "project"],
    action: { kind: "rename" },
    disabled: !input.canEdit || input.deleted,
  });
  if (input.canSaveTemplate && input.canEdit && !input.deleted) {
    items.push({
      id: "save-template",
      label: "Save as template",
      group: "Project",
      keywords: ["template", "reuse", "preset"],
      action: { kind: "save-template" },
      disabled: input.busy,
    });
  }
  return items;
}

// Lower case, accents dropped, anything but letters and digits a space between words.
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const words = (text: string) => normalize(text).split(" ").filter((word) => word !== "");

// How well an item matches the query's words, lower being better, or null when one word matches nothing. A word
// matches the start of a word of the label or of a keyword, or (three letters or more) any part of the label.
function score(item: SearchItem, query: string, tokens: string[]): number | null {
  const label = normalize(item.label);
  const labelWords = label.split(" ");
  const keywordWords = item.keywords.flatMap(words);
  let worst = 0;
  for (const token of tokens) {
    if (labelWords.some((word) => word.startsWith(token))) worst = Math.max(worst, 1);
    else if (keywordWords.some((word) => word.startsWith(token))) worst = Math.max(worst, 2);
    else if (token.length >= 3 && label.includes(token)) worst = Math.max(worst, 3);
    else return null;
  }
  return label.startsWith(query) ? 0 : worst;
}

// The items that match the query, best first; ties keep the list's order, and what cannot run comes after what can at
// the same rank. An empty query keeps every item in order.
export function searchFeatures(items: readonly SearchItem[], query: string): SearchItem[] {
  const normalized = normalize(query);
  const tokens = normalized.split(" ").filter((token) => token !== "");
  if (tokens.length === 0) return [...items];
  const ranked: { item: SearchItem; rank: number; at: number }[] = [];
  items.forEach((item, at) => {
    const s = score(item, normalized, tokens);
    if (s !== null) ranked.push({ item, rank: s * 2 + (item.disabled ? 1 : 0), at });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.at - b.at).map(({ item }) => item);
}
