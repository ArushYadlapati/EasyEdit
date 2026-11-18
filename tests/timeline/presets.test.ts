import { describe, expect, it } from "vitest";
import {
  CUSTOM_SIZE_ONLY,
  DEFAULT_TRANSFORM,
  FORMAT_PRESETS,
  FRAME_SIZE_MESSAGE,
  FormatId,
  PresetId,
  TRACK_ACCEPTS,
  TextClip,
  TimelineDoc,
  createEmptyDoc,
  docDuration,
  formatFields,
  formatFor,
  formatLabel,
  isFrameSize,
  isPresetId,
} from "@/lib/timeline";

function TextClipSchemaFixture(overrides: Record<string, unknown>) {
  return TextClip.parse({
    id: "x",
    type: "text",
    start: 0,
    duration: 30,
    transform: DEFAULT_TRANSFORM,
    text: "hi",
    style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700, color: "#fff", align: "center" },
    ...overrides,
  });
}

describe("timeline presets", () => {
  it("short_9x16 is 1080x1920 at 30fps", () => {
    const d = createEmptyDoc("short_9x16");
    expect([d.width, d.height, d.fps]).toEqual([1080, 1920, 30]);
    expect(TimelineDoc.parse(d)).toEqual(d);
  });

  it("every preset has exact dimensions", () => {
    expect(FORMAT_PRESETS.short_9x16).toMatchObject({ width: 1080, height: 1920 });
    expect(FORMAT_PRESETS.feed_4x5).toMatchObject({ width: 1080, height: 1350 });
    expect(FORMAT_PRESETS.square_1x1).toMatchObject({ width: 1080, height: 1080 });
    expect(FORMAT_PRESETS.long_16x9).toMatchObject({ width: 1920, height: 1080 });
    expect(FORMAT_PRESETS.long_4k).toMatchObject({ width: 3840, height: 2160 });
  });

  it("default tracks", () => {
    const d = createEmptyDoc("long_16x9");
    expect(d.tracks.map((t) => [t.id, t.kind])).toEqual([
      ["v1", "video"],
      ["t1", "text"],
      ["a1", "audio"],
    ]);
    expect(d.tracks.map((t) => t.name)).toEqual(["Video 1", "Text 1", "Audio 1"]);
    for (const t of d.tracks) {
      expect([t.muted, t.hidden, t.locked, t.clips]).toEqual([false, false, false, []]);
    }
  });

  it("track accept rules", () => {
    expect(TRACK_ACCEPTS).toEqual({
      video: ["video", "image"],
      overlay: ["image", "video"],
      text: ["text"],
      caption: [],
      audio: ["audio"],
      shape: ["shape"],
    });
  });

  it("docDuration is the furthest clip end", () => {
    const d = createEmptyDoc("short_9x16");
    expect(docDuration(d)).toBe(0);
    d.tracks[1].clips.push({
      id: "x",
      type: "text",
      start: 30,
      duration: 45,
      transform: DEFAULT_TRANSFORM,
      text: "hi",
      style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700, color: "#fff", align: "center" },
    });
    expect(docDuration(d)).toBe(75);
  });

  it("rejects a non-integer start", () => {
    expect(() => TextClipSchemaFixture({ start: 1.5 })).toThrow();
  });

  it("createEmptyDoc returns independent objects", () => {
    const a = createEmptyDoc("short_9x16");
    const b = createEmptyDoc("short_9x16");
    expect(a).toEqual(b);
    expect(a.tracks).not.toBe(b.tracks);
    expect(a.tracks[0]).not.toBe(b.tracks[0]);
    expect(a.tracks[0].clips).not.toBe(b.tracks[0].clips);
  });
});

describe("custom sizes", () => {
  it("the five named sizes keep their ids, and custom is one more format", () => {
    expect(PresetId.options).toEqual(["short_9x16", "feed_4x5", "square_1x1", "long_16x9", "long_4k"]);
    expect(FormatId.options).toEqual(["short_9x16", "feed_4x5", "square_1x1", "long_16x9", "long_4k", "custom"]);
  });

  it("a custom frame is whole, even, 16 to 4096 a side, and at most the area of 4K", () => {
    for (const [width, height] of [
      [16, 16],
      [3840, 2160],
      [4096, 2024],
      [816, 1056],
    ]) {
      expect(isFrameSize(width, height), `${width} x ${height}`).toBe(true);
    }
    for (const [width, height] of [
      [14, 16],
      [4098, 16],
      [1081, 1920],
      [1080.5, 1920],
      [4096, 2026],
      [0, 0],
      [NaN, 16],
    ]) {
      expect(isFrameSize(width, height), `${width} x ${height}`).toBe(false);
    }
  });

  it("the size message", () => {
    expect(FRAME_SIZE_MESSAGE).toBe("Width and height go from 16 to 4096 pixels, up to the area of 4K (3840 × 2160).");
  });

  it("the message for a size given with a named format", () => {
    expect(CUSTOM_SIZE_ONLY).toBe("Give a width and height only with the custom format.");
  });

  it("isPresetId knows only the five ids", () => {
    for (const id of PresetId.options) expect(isPresetId(id), id).toBe(true);
    for (const id of ["custom", "toString", "constructor", ""]) expect(isPresetId(id), id).toBe(false);
  });

  it("formatFor names a preset's own size", () => {
    expect(formatFor(1080, 1920)).toBe("short_9x16");
    expect(formatFor(1080, 1350)).toBe("feed_4x5");
    expect(formatFor(1080, 1080)).toBe("square_1x1");
    expect(formatFor(1920, 1080)).toBe("long_16x9");
    expect(formatFor(3840, 2160)).toBe("long_4k");
    expect(formatFor(816, 1056)).toBe("custom");
    expect(formatFor(1920, 1920)).toBe("custom");
  });

  it("formatFields", () => {
    expect(formatFields({ width: 1920, height: 1080 })).toEqual({ format: "long_16x9" });
    expect(formatFields({ width: 816, height: 1056 })).toEqual({ format: "custom", width: 816, height: 1056 });
  });

  it("formatLabel", () => {
    expect(formatLabel({ format: "feed_4x5" })).toBe("Feed 4:5");
    expect(formatLabel({ format: "custom", width: 816, height: 1056 })).toBe("Custom 816 × 1056");
    expect(formatLabel({ format: "custom" })).toBe("Custom size");
    expect(formatLabel({ format: "short_9x16", width: 1, height: 1 })).toBe("Vertical 9:16");
  });

  it("createEmptyDoc makes a custom doc at its size", () => {
    const d = createEmptyDoc("custom", { width: 816, height: 1056 });
    expect(d).toMatchObject({ format: "custom", width: 816, height: 1056, fps: 30 });
    expect(d.tracks.map((t) => t.id)).toEqual(["v1", "t1", "a1"]);
    expect(TimelineDoc.parse(d)).toEqual(d);
    expect(createEmptyDoc("long_16x9", { width: 10, height: 10 })).toMatchObject({ width: 1920, height: 1080 });
    expect(() => createEmptyDoc("custom")).toThrow("A custom format needs a width and height");
  });
});
