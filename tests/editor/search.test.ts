import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { editMenu, helpMenu, viewMenu, type MenuEntry } from "@/lib/editor/menus";
import { searchFeatures, searchItems, type SearchInput, type SearchItem } from "@/lib/editor/search";

const input = (over: Partial<SearchInput> = {}): SearchInput => ({
  canEdit: true,
  deleted: false,
  busy: false,
  hasSelection: false,
  canUndo: false,
  canRedo: false,
  canPaste: false,
  snapping: true,
  showSafeZones: false,
  showAudioMeter: true,
  canZoomIn: true,
  canZoomOut: true,
  leftTabs: [
    { id: "text", label: "Text" },
    { id: "media", label: "Media" },
    { id: "captions", label: "Captions" },
    { id: "brand", label: "Brand kit" },
  ],
  rightTabs: [
    { id: "inspect", label: "Inspect" },
    { id: "activity", label: "Activity" },
    { id: "effects", label: "Effects" },
    { id: "review", label: "Review" },
  ],
  trackCount: 3,
  hasCaptions: false,
  canSaveTemplate: true,
  ...over,
});

const labels = (query: string, over: Partial<SearchInput> = {}) => searchFeatures(searchItems(input(over)), query).map((i) => i.label);
const item = (id: string, over: Partial<SearchInput> = {}) => searchItems(input(over)).find((i) => i.id === id);

describe("the search's list", () => {
  it("has the tools, the edits, playback, the panels, settings and the project's actions, each id once", () => {
    const items = searchItems(input());
    const groups = [...new Set(items.map((i) => i.group))];
    expect(groups).toEqual(["Tools", "Add", "Edit", "Playback", "Timeline", "Panels", "Inspect", "Effects", "Review", "Captions", "Media", "Settings", "Project", "Help"]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const label of ["Razor tool", "Arrow tool", "Line tool", "Star shape", "Add title", "Add audio track", "Split at the playhead", "Brand kit", "Effects panel", "General settings", "Export", "Rename project", "Save as template"]) {
      expect(items.map((i) => i.label)).toContain(label);
    }
    // Opening the search is not something to search for.
    expect(items.some((i) => i.command === "search")).toBe(false);
  });

  it("greys what changes the project for a viewer, and keeps what a viewer can do", () => {
    const viewer = { canEdit: false };
    expect(item("command:tool-razor", viewer)?.disabled).toBe(true);
    expect(item("text:title", viewer)?.disabled).toBe(true);
    expect(item("track:video", viewer)?.disabled).toBe(true);
    expect(item("rename", viewer)?.disabled).toBe(true);
    expect(item("command:tool-select", viewer)?.disabled).toBe(false);
    expect(item("command:play-pause", viewer)?.disabled).toBe(false);
    expect(item("panel:right:activity", viewer)?.disabled).toBe(false);
    expect(item("command:export", viewer)?.disabled).toBe(false);
    expect(item("save-template", viewer)).toBeUndefined();
  });

  it("greys what has nothing to act on, as the menus do", () => {
    expect(item("command:paste")?.disabled).toBe(true);
    expect(item("command:paste", { canPaste: true })?.disabled).toBe(false);
    expect(item("command:delete")?.disabled).toBe(true);
    expect(item("command:delete", { hasSelection: true })?.disabled).toBe(false);
    expect(item("command:undo", { canUndo: true })?.disabled).toBe(false);
    expect(item("track:caption", { hasCaptions: true })?.disabled).toBe(true);
    expect(item("track:video", { trackCount: LIMITS.tracksPerProject })?.disabled).toBe(true);
    expect(item("save-template", { canSaveTemplate: false })).toBeUndefined();
  });

  it("in a deleted project keeps only Export, the shortcuts, settings, panel sizes and the AI agents page", () => {
    const enabled = searchItems(input({ deleted: true })).filter((i) => !i.disabled).map((i) => i.id);
    expect(enabled).toEqual(["reset-layout", "settings:project", "settings:general", "settings:shortcuts", "command:show-shortcuts", "command:export", "agents"]);
  });

  it("says whether the switches are on", () => {
    expect(item("command:toggle-snapping")?.checked).toBe(true);
    expect(item("safe-zones", { showSafeZones: true })?.checked).toBe(true);
  });

  it("finds a panel without the side panels' tabs only when they are given", () => {
    expect(searchItems(input({ leftTabs: [], rightTabs: [] })).some((i) => i.group === "Panels" && i.id !== "reset-layout")).toBe(false);
    // A tab the search has no words for is still found by its label.
    expect(labels("captions", { leftTabs: [{ id: "captions", label: "Captions" }] })[0]).toBe("Captions panel");
  });
});

describe("matching", () => {
  it("keeps every item in order for an empty query, but the parts of panels, which are found by name", () => {
    expect(labels("   ")).toEqual(searchItems(input()).filter((i) => !i.findOnly).map((i) => i.label));
    expect(labels("")).not.toContain("Mask");
  });

  it("puts a label that starts with the query first", () => {
    expect(labels("razor")[0]).toBe("Razor tool");
    expect(labels("snap")[0]).toBe("Snapping");
    expect(labels("exp")[0]).toBe("Export");
  });

  it("finds things by the words people use for them", () => {
    expect(labels("blade")).toContain("Razor tool");
    expect(labels("fade")[0]).toBe("Effects panel");
    expect(labels("upload")[0]).toBe("Media panel");
    expect(labels("colors")[0]).toBe("Brand kit");
    expect(labels("circle")).toContain("Ellipse shape");
    expect(labels("render")[0]).toBe("Export");
    expect(labels("hotkeys")).toContain("Keyboard shortcuts");
  });

  it("needs every word to match, in any order, ignoring case, accents and punctuation", () => {
    expect(labels("track audio")[0]).toBe("Add audio track");
    expect(labels("AUDIO-track")[0]).toBe("Add audio track");
    expect(labels("pàste")[0]).toBe("Paste");
    expect(labels("audio zebra")).toEqual([]);
  });

  it("matches the middle of a word from three letters on", () => {
    expect(labels("napping")).toEqual(["Snapping"]);
    expect(labels("na")).not.toContain("Snapping");
  });

  it("lists what can run before what cannot at the same rank, and a better match before either", () => {
    const made = (id: string, label: string, disabled: boolean, keywords: string[] = []) =>
      ({ id, label, group: "Edit" as const, keywords, action: { kind: "rename" as const }, disabled });
    const items = [made("a", "Split one", true), made("b", "Split two", false), made("c", "Other", false, ["split"]), made("d", "Cut", false)];
    expect(searchFeatures(items, "split").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("lists the guide's lessons under Help on a server that has it, found by name and by what their chapters teach", () => {
    const guide = [
      { title: "The basics", path: "/learn", chapters: ["Welcome", "Export"] },
      { title: "Effects, speed and color", path: "/learn/effects", chapters: ["Transitions", "Keyframes", "Speed", "Color"] },
    ];
    expect(searchItems(input()).filter((i) => i.group === "Help").map((i) => i.id)).toEqual(["agents"]);
    const help = searchItems(input({ guide })).filter((i) => i.group === "Help" && i.id !== "agents");
    expect(help.map((i) => [i.label, i.action])).toEqual([
      ["Guide: The basics", { kind: "guide", path: "/learn" }],
      ["Guide: Effects, speed and color", { kind: "guide", path: "/learn/effects" }],
    ]);
    expect(labels("keyframes", { guide })).toContain("Guide: Effects, speed and color");
    expect(labels("tutorial", { guide })).toEqual(["Guide: The basics", "Guide: Effects, speed and color"]);
    // A lesson is never ahead of the thing itself: Export stays the first answer to "export".
    expect(labels("export", { guide })[0]).toBe("Export");
    // A deleted project's editor can still be learnt from.
    expect(searchItems(input({ guide, deleted: true })).filter((i) => i.group === "Help").every((i) => !i.disabled)).toBe(true);
  });
});

describe("AI agents", () => {
  it.each(["agent", "ai", "AI agent", "claude", "chatgpt", "codex", "cursor", "connect", "mcp"])("“%s” finds the AI agents page first", (query) => {
    const [first] = searchFeatures(searchItems(input()), query);
    expect(first).toMatchObject({ label: "Connect an AI agent", group: "Help", action: { kind: "guide", path: "/agents" } });
  });

  it("a viewer and a deleted project's editor can open it too", () => {
    expect(item("agents", { canEdit: false, deleted: true })?.disabled).toBeFalsy();
  });
});

describe("the newer features", () => {
  const selected = { hasSelection: true };
  it.each<[string, string]>([
    ["mask", "Mask"],
    ["masks", "Mask"],
    ["version", "Versions"],
    ["comment", "Comments"],
    ["feedback", "Comments"],
    ["colour", "Color"],
    ["color", "Color"],
    ["grading", "Color"],
    ["speed", "Speed"],
    ["slow motion", "Speed"],
    ["scopes", "Scopes"],
    ["waveform", "Scopes"],
    ["ramp", "Speed ramp"],
    ["multicam", "Multicam"],
    ["stabilise", "Stabilize"],
    ["shaky", "Stabilize"],
    ["reframe", "Reframe"],
    ["follow", "Follow"],
    ["nest", "Nest"],
    ["remove background", "Remove background"],
    ["denoise", "Noise reduction"],
    ["green screen", "Green screen"],
    ["chroma", "Green screen"],
    ["transitions", "Transitions"],
    ["keyframes", "Keyframes"],
    ["language", "Captions in other languages"],
    ["srt", "Subtitle files: SRT and VTT"],
    ["record", "Record voiceover, screen or camera"],
    ["microphone", "Record voiceover, screen or camera"],
    ["help", "Keyboard shortcuts"],
  ])("“%s” finds %s first", (query, label) => {
    const found = searchFeatures(searchItems(input(selected)), query);
    expect(found[0]?.label).toBe(label);
  });

  it("“speed” still finds Reverse clip and Freeze frame, after Speed", () => {
    const found = labels("speed", selected);
    expect(found.slice(0, 2)).toEqual(["Speed", "Speed ramp"]);
    expect(found).toContain("Reverse clip");
    expect(found).toContain("Freeze frame");
  });

  it("a part of a clip's panel needs a selected clip, and says so; opening it opens the tab that holds it", () => {
    expect(item("feature:mask")).toMatchObject({ disabled: true, note: "Select a clip first", action: { kind: "panel", side: "right", tab: "inspect" } });
    expect(item("feature:mask", selected)).toMatchObject({ disabled: false, action: { kind: "panel", side: "right", tab: "inspect" } });
    expect(item("feature:mask", selected)?.note).toBeUndefined();
    // Review and captions are there with nothing selected.
    expect(item("feature:versions")).toMatchObject({ disabled: false, action: { kind: "panel", side: "right", tab: "review" } });
    expect(item("feature:captions-languages")).toMatchObject({ disabled: false, action: { kind: "panel", side: "left", tab: "captions" } });
    // Without the side panels, nothing points at them.
    expect(searchItems(input({ leftTabs: [], rightTabs: [] })).some((i) => i.id.startsWith("feature:"))).toBe(false);
  });
});

describe("every command in the top menus", () => {
  // The entry's own action, as the search would run it.
  const sameAction = (entry: MenuEntry, found: SearchItem): boolean => {
    if (entry.command) return found.command === entry.command;
    if (entry.id === "help:agents") return found.id === "agents";
    if (entry.id.startsWith("guide:")) return found.action.kind === "guide";
    return found.id === entry.id;
  };
  const guide = [{ title: "The basics", path: "/learn", chapters: ["Welcome"] }];
  const menuInput = { ...input({ guide }), hasSelection: true, canUndo: true, canRedo: true, canPaste: true };
  const entries = [...editMenu(menuInput), ...viewMenu(menuInput), ...helpMenu(menuInput, guide)];

  it.each(entries.map((e) => [e.label, e] as const))("“%s” is found by its own name", (label, entry) => {
    const found = searchFeatures(searchItems(menuInput), label.replace(/…$/, ""));
    expect(found.slice(0, 3).some((f) => sameAction(entry, f))).toBe(true);
  });
});
