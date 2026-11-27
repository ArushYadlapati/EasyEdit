import { expect, it } from "vitest";
import { FOLDS_KEY, OPEN_BY_DEFAULT, SECTION_ORDER, createFoldStore, isOpen, parseFolds, sectionChanges } from "@/lib/editor/inspector-folds";
import { text, video } from "./fixtures";

it("opens two or three sections for each kind of clip, all of them sections that kind has", () => {
  for (const [kind, open] of Object.entries(OPEN_BY_DEFAULT)) {
    // A caption clip has its own short inspector (the captions' style, then Timing), so its one entry is Timing.
    if (kind === "caption") {
      expect(open).toEqual(["timing"]);
      continue;
    }
    expect(open.length, kind).toBeGreaterThanOrEqual(2);
    expect(open.length, kind).toBeLessThanOrEqual(3);
    for (const id of open) expect(SECTION_ORDER[kind as keyof typeof SECTION_ORDER], `${kind}.${id}`).toContain(id);
  }
});

it("puts a video's place and timing first, then its sound, then its looks, then the rest", () => {
  expect(SECTION_ORDER.video.slice(0, 6)).toEqual(["position", "timing", "speed", "sound", "color", "stylize"]);
  expect(SECTION_ORDER.text.slice(0, 3)).toEqual(["text", "position", "timing"]);
});

it("reads only true or false for a kind and a section, and nothing from text that is not that", () => {
  expect(parseFolds('{"video.color":true,"text.position":false,"bad key":true,"video.sound":"yes"}')).toEqual({ "video.color": true, "text.position": false });
  for (const junk of [null, undefined, "", "not json", "[1,2]", "null", "3"]) expect(parseFolds(junk), String(junk)).toEqual({});
});

it("a section is as the person left it, else as its kind of clip opens it", () => {
  expect(isOpen({}, "video", "sound")).toBe(true);
  expect(isOpen({}, "video", "color")).toBe(false);
  expect(isOpen({ "video.color": true, "video.sound": false }, "video", "color")).toBe(true);
  expect(isOpen({ "video.color": true, "video.sound": false }, "video", "sound")).toBe(false);
  // Each kind of clip keeps its own: closing Position on a text leaves it open on a video.
  expect(isOpen({ "text.position": false }, "video", "position")).toBe(true);
});

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}

it("keeps a choice in this browser's storage and tells whoever listens", () => {
  const storage = memoryStorage();
  const store = createFoldStore(() => storage);
  let heard = 0;
  store.subscribe(() => heard++);
  const before = store.get();
  expect(store.get()).toBe(before); // the same object while nothing changes, as a React snapshot needs
  store.set("video", "color", true);
  expect(heard).toBe(1);
  expect(JSON.parse(storage.items.get(FOLDS_KEY)!)).toEqual({ "video.color": true });
  expect(store.get()).toEqual({ "video.color": true });
  // Another store on the same storage (another tab, the next visit) reads it.
  expect(createFoldStore(() => storage).get()).toEqual({ "video.color": true });
});

it("keeps choices for this page only where storage is blocked", () => {
  const store = createFoldStore(() => ({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  }));
  expect(store.get()).toEqual({});
  store.set("text", "blend", true);
  expect(store.get()).toEqual({ "text.blend": true });
  expect(createFoldStore(() => null).get()).toEqual({});
});

it("names what in a section is not as a new clip has it", () => {
  const plain = video("c1", 0, 30);
  for (const id of SECTION_ORDER.video) expect(sectionChanges(plain, id), id).toEqual([]);
  const changed = video("c1", 0, 30, {
    volume: 0.5,
    fadeIn: 10,
    speed: 2,
    blend: "screen",
    mask: { shape: "ellipse", x: 0.5, y: 0.5, width: 0.5, height: 0.5, feather: 0 },
    adjust: { contrast: 0.2 },
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 15, opacity: 1, fit: "cover", crop: { left: 0.1, top: 0, right: 0, bottom: 0 } },
  });
  expect(sectionChanges(changed, "sound")).toEqual(["Volume", "Fades"]);
  expect(sectionChanges(changed, "speed")).toEqual(["Speed"]);
  expect(sectionChanges(changed, "blend")).toEqual(["Blend mode"]);
  expect(sectionChanges(changed, "mask")).toEqual(["Mask"]);
  expect(sectionChanges(changed, "color")).toEqual(["Colors"]);
  expect(sectionChanges(changed, "crop")).toEqual(["Crop"]);
  expect(sectionChanges(changed, "position")).toEqual(["Rotation"]);
  // A keyed volume counts even at 100%.
  expect(sectionChanges(video("c1", 0, 30, { keyframes: { volume: [{ at: 0, value: 1 }] } }), "sound")).toEqual(["Volume"]);
  expect(sectionChanges(text("x1", 0, 30, { slot: { name: "slot_1" } }), "slot")).toEqual(["Slot"]);
});
