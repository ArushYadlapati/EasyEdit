import { describe, expect, it } from "vitest";
import type { Sizer } from "@/lib/editor/clip-box";
import { clipFieldOps, clipFieldValue, fieldContext, FIELD_LABEL, type ClipField, type FieldContext } from "@/lib/editor/inspector-fields";
import { findClip } from "@/lib/editor/store";
import { applyOps, prepareOps, type Clip, type OpInput } from "@/lib/timeline";
import { sampleDoc, text, video } from "./fixtures";

const clip = (id: string) => findClip(sampleDoc(), id)!.clip;
const patch = (p: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: "x1", patch: p }];
// Where no box is needed.
const BASE: FieldContext = { fps: 30, frame: { width: 1080, height: 1920 }, units: "px", box: null, lockAspect: true };
// x1's box: "hi" at 64 px, measured as half the font size a letter.
const ctx: FieldContext = { ...BASE, box: { width: 64, height: 76.8 } };
const withTransform = (c: Clip, t: Record<string, unknown>) => ({ ...c, transform: { ...c.transform, ...t } }) as Clip;

describe("position and size in your units", () => {
  it("position shows in pixels from the frame's edges to the centre", () => {
    const x2 = clip("x2");
    expect(clipFieldValue(x2, "x", ctx)).toBe("540");
    expect(clipFieldValue(withTransform(x2, { x: 1 / 3 }), "x", ctx)).toBe("360");
    expect(clipFieldOps(clip("x1"), "x", "270", ctx)).toEqual([{ op: "update_clip", clipId: "x1", patch: { transform: { x: 0.25 } } }]);
    expect(clipFieldOps(clip("x1"), "y", "1440", ctx)).toEqual(patch({ transform: { y: 0.75 } }));
  });

  it("inches and centimetres at 96 px per inch", () => {
    const inches = { ...ctx, units: "in" } as const;
    expect(clipFieldValue(clip("x1"), "y", inches)).toBe("10");
    expect(clipFieldOps(clip("x1"), "y", "5", inches)).toEqual(patch({ transform: { y: 0.25 } }));
    const cm = { ...ctx, units: "cm" } as const;
    expect(clipFieldValue(clip("x1"), "x", cm)).toBe("14.29");
    expect(clipFieldOps(clip("x1"), "x", "2.54", cm)).toEqual(patch({ transform: { x: 0.088889 } }));
  });

  it("a typed position that shows as the value shown is no change", () => {
    const cm = { ...ctx, units: "cm" } as const;
    expect(clipFieldOps(clip("x1"), "x", "14.29", cm)).toEqual([]);
    expect(clipFieldOps(clip("x1"), "x", "540", ctx)).toEqual([]);
    expect(clipFieldOps(clip("x1"), "y", "960.2", ctx)).toEqual([]);
    expect(clipFieldOps(clip("x1"), "y", "961", ctx)).toEqual(patch({ transform: { y: 0.500521 } }));
    expect(clipFieldOps(clip("x1"), "x", "abc", ctx)).toBeNull();
  });

  it("width and height follow the lock", () => {
    const x1 = clip("x1");
    expect(clipFieldValue(x1, "width", ctx)).toBe("64");
    expect(clipFieldValue(x1, "height", ctx)).toBe("77");
    expect(clipFieldOps(x1, "width", "128", ctx)).toEqual(patch({ transform: { scale: 2 } }));
    expect(clipFieldOps(x1, "height", "153.6", ctx)).toEqual(patch({ transform: { scale: 2 } }));
    const free = { ...ctx, lockAspect: false };
    expect(clipFieldOps(x1, "width", "128", free)).toEqual(patch({ transform: { stretch: 2 } }));
    expect(clipFieldOps(x1, "height", "38.4", free)).toEqual(patch({ transform: { scale: 0.5, stretch: 2 } }));
    for (const raw of ["0", "-5", "abc"]) {
      expect(clipFieldOps(x1, "width", raw, ctx)).toBeNull();
      expect(clipFieldOps(x1, "height", raw, free)).toBeNull();
    }
    // Factors are kept to 4 decimals.
    expect(clipFieldOps(x1, "height", "100", ctx)).toEqual(patch({ transform: { scale: 1.3021 } }));
    expect(clipFieldOps(x1, "height", "100", free)).toEqual(patch({ transform: { scale: 1.3021, stretch: 0.768 } }));
    expect(clipFieldOps(x1, "width", "100", free)).toEqual(patch({ transform: { stretch: 1.5625 } }));
    expect(clipFieldOps(x1, "width", "70", free)).toEqual(patch({ transform: { stretch: 1.0938 } }));
    expect(clipFieldOps(x1, "height", "77", ctx)).toEqual([]);
    expect(clipFieldOps(x1, "width", "64", free)).toEqual([]);
    expect([FIELD_LABEL.width, FIELD_LABEL.height, FIELD_LABEL.scale]).toEqual(["size change", "size change", "size change"]);
  });

  it("width and height are the drawn size, with the scale and stretch, in the chosen unit", () => {
    const stretched = withTransform(clip("x1"), { scale: 2, stretch: 1.5 });
    expect(clipFieldValue(stretched, "width", ctx)).toBe("192");
    expect(clipFieldValue(stretched, "height", ctx)).toBe("154");
    expect(clipFieldValue(stretched, "width", { ...ctx, units: "in" })).toBe("2");
    // Locked: the whole size, shape kept. Unlocked: each side on its own, the other side unmoved.
    expect(clipFieldOps(stretched, "width", "96", ctx)).toEqual(patch({ transform: { scale: 1 } }));
    expect(clipFieldOps(stretched, "width", "96", { ...ctx, lockAspect: false })).toEqual(patch({ transform: { stretch: 0.75 } }));
    expect(clipFieldOps(stretched, "height", "307.2", { ...ctx, lockAspect: false })).toEqual(patch({ transform: { scale: 4, stretch: 0.75 } }));
    expect(clipFieldOps(stretched, "width", "1", { ...ctx, units: "in" })).toEqual(patch({ transform: { scale: 1 } }));
  });

  it("width and height need a box", () => {
    expect(clipFieldValue(clip("x1"), "width", BASE)).toBe("");
    expect(clipFieldOps(clip("x1"), "height", "100", BASE)).toBeNull();
  });

  it("fieldContext gives the kept box", () => {
    const sizer: Sizer = { source: () => null, measure: (c, s) => (s.length * c.style.fontSize) / 2 };
    const doc = sampleDoc();
    const x1 = findClip(doc, "x1")!.clip;
    expect(fieldContext(doc, x1, { units: "in", lockAspect: false }, sizer)).toEqual({
      fps: 30,
      frame: { width: 1080, height: 1920 },
      units: "in",
      box: { width: 64, height: 76.8 },
      lockAspect: false,
    });
    expect(fieldContext(doc, x1)).toEqual({ fps: 30, frame: { width: 1080, height: 1920 }, units: "px", box: null, lockAspect: true });
    const cropped = withTransform(x1, { crop: { left: 0.5, top: 0, right: 0, bottom: 0.25 } });
    const box = fieldContext(doc, cropped, { units: "px", lockAspect: true }, sizer).box!;
    expect(box.width).toBeCloseTo(32, 6);
    expect(box.height).toBeCloseTo(57.6, 6);
    expect(fieldContext(doc, findClip(doc, "c1")!.clip, undefined, sizer).box).toEqual({ width: 1080, height: 1920 });
    expect(fieldContext(doc, video("au", 0, 30, { type: "audio" }), undefined, sizer).box).toBeNull();
  });
});

describe("inspector fields", () => {
  it.each<[ClipField, string, OpInput[] | null]>([
    ["text", "Hello", patch({ text: "Hello" })],
    ["fontSize", "72.6", patch({ style: { fontSize: 73 } })],
    ["fontSize", "2", patch({ style: { fontSize: 8 } })],
    ["fontSize", "abc", null],
    ["fontWeight", "500", patch({ style: { fontWeight: 500 } })],
    ["color", "#FF0000", patch({ style: { color: "#ff0000" } })],
    ["color", "red", null],
    ["align", "left", patch({ style: { align: "left" } })],
    ["x", "270", patch({ transform: { x: 0.25 } })],
    ["scale", "150", patch({ transform: { scale: 1.5 } })],
    ["scale", "0", null],
    ["rotation", "-45", patch({ transform: { rotation: -45 } })],
    ["opacity", "140", patch({ transform: { opacity: 1 } })],
    ["start", "0.5", [{ op: "move_clip", clipId: "x1", start: 15 }]],
    ["start", "-1", null],
    ["duration", "0.5", [{ op: "trim_clip", clipId: "x1", edge: "end", to: 15 }]],
    ["duration", "0", [{ op: "trim_clip", clipId: "x1", edge: "end", to: 1 }]],
  ])("%s = %s", (field, raw, ops) => {
    expect(clipFieldOps(clip("x1"), field, raw, BASE)).toEqual(ops);
    if (ops) expect(() => applyOps(sampleDoc(), prepareOps(ops))).not.toThrow();
  });

  it("shows values in the inspector's units", () => {
    const x2 = clip("x2"); // starts at frame 90, 30 frames long
    expect((["start", "duration", "x", "scale", "opacity", "fontSize", "color"] as const).map((f) => clipFieldValue(x2, f, BASE)))
      .toEqual(["3.00", "1.00", "540", "100", "100", "64", "#ffffff"]);
    expect(clipFieldValue(text("t", 0, 30, { transform: { ...x2.transform, x: 1 / 3 } }), "x", BASE)).toBe("360");
  });

  it("has no text or style fields for a clip that is not text, and labels each change", () => {
    expect(clipFieldOps(clip("c1"), "text", "x", BASE)).toBeNull();
    expect(clipFieldOps(clip("c1"), "color", "#ffffff", BASE)).toBeNull();
    expect(clipFieldOps(clip("c1"), "x", "270", BASE)).toEqual([{ op: "update_clip", clipId: "c1", patch: { transform: { x: 0.25 } } }]);
    expect([FIELD_LABEL.text, FIELD_LABEL.color, FIELD_LABEL.scale, FIELD_LABEL.duration]).toEqual(["text edit", "style change", "size change", "timing change"]);
  });
});

describe("inspector fields, fix round 1", () => {
  it("a time that rounds to the current frame is nothing to do, not invalid", () => {
    const x2 = clip("x2"); // frames 90 to 120
    expect(clipFieldOps(x2, "start", "3.01", BASE)).toEqual([]);
    expect(clipFieldOps(x2, "duration", "0.99", BASE)).toEqual([]);
    expect(clipFieldOps(x2, "start", "3.1", BASE)).toEqual([{ op: "move_clip", clipId: "x2", start: 93 }]);
  });

  it("accepts only plain decimal numbers", () => {
    expect(clipFieldOps(clip("x1"), "start", "0x10", BASE)).toBeNull();
    expect(clipFieldOps(clip("x1"), "start", "1e2", BASE)).toBeNull();
    expect(clipFieldOps(clip("x1"), "rotation", "Infinity", BASE)).toBeNull();
    expect(clipFieldOps(clip("x1"), "rotation", " +1.5 ", BASE)).toEqual(patch({ transform: { rotation: 1.5 } }));
    expect(clipFieldOps(clip("x1"), "rotation", "-.5", BASE)).toEqual(patch({ transform: { rotation: -0.5 } }));
    expect(clipFieldOps(clip("x1"), "rotation", "2.", BASE)).toEqual(patch({ transform: { rotation: 2 } }));
    expect(clipFieldOps(clip("x1"), "rotation", ".", BASE)).toBeNull();
  });

  it.each([24, 60])("converts seconds and frames at %i fps, both ways", (fps) => {
    const t = text("t", 2 * fps, fps / 2); // starts at 2 s, half a second long
    expect(clipFieldValue(t, "start", { ...BASE, fps })).toBe("2.00");
    expect(clipFieldValue(t, "duration", { ...BASE, fps })).toBe("0.50");
    expect(clipFieldOps(t, "start", "1.5", { ...BASE, fps })).toEqual([{ op: "move_clip", clipId: "t", start: 1.5 * fps }]);
    expect(clipFieldOps(t, "duration", "1.25", { ...BASE, fps })).toEqual([{ op: "trim_clip", clipId: "t", edge: "end", to: 2 * fps + 1.25 * fps }]);
  });

  it("writes y to y, keeps the font size at most 1000, lower-cases the color and rounds the weight", () => {
    expect(clipFieldOps(clip("x1"), "y", "1440", BASE)).toEqual(patch({ transform: { y: 0.75 } }));
    expect(clipFieldOps(clip("x1"), "fontSize", "5000", BASE)).toEqual(patch({ style: { fontSize: 1000 } }));
    const shouty = text("t", 0, 30, { style: { fontFamily: "Geist", fontSize: 64, fontWeight: 700, color: "#FFAA00", align: "center" } });
    expect(clipFieldValue(shouty, "color", BASE)).toBe("#ffaa00");
    expect(clipFieldOps(clip("x1"), "fontWeight", "550.4", BASE)).toEqual(patch({ style: { fontWeight: 550 } }));
  });
});

describe("a media clip's length", () => {
  // 90 frames at 100, from frame 60 of a 375-frame video: it can end at 415 at the latest.
  const media = video("m", 100, 90, { in: 60 });

  it("a typed length stops at the end of the media", () => {
    expect(clipFieldOps(media, "duration", "60", BASE, 375)).toEqual([{ op: "trim_clip", clipId: "m", edge: "end", to: 415 }]);
    expect(clipFieldOps(media, "duration", "60", BASE)).toEqual([{ op: "trim_clip", clipId: "m", edge: "end", to: 1900 }]);
    expect(clipFieldOps(video("m", 100, 315, { in: 60 }), "duration", "60", BASE, 375)).toEqual([]);
    // A length inside the media is taken as typed.
    expect(clipFieldOps(media, "duration", "5", BASE, 375)).toEqual([{ op: "trim_clip", clipId: "m", edge: "end", to: 250 }]);
    // A clip that already starts past the end of its media keeps at least one frame, as a trim on the timeline does.
    expect(clipFieldOps(video("m", 100, 90, { in: 400 }), "duration", "60", BASE, 375)).toEqual([{ op: "trim_clip", clipId: "m", edge: "end", to: 101 }]);
  });

  it("is not held for text or an image", () => {
    expect(clipFieldOps(text("t", 100, 90), "duration", "60", BASE, 375)).toEqual([{ op: "trim_clip", clipId: "t", edge: "end", to: 1900 }]);
    const image = video("i", 100, 90, { type: "image", in: 0 });
    expect(clipFieldOps(image, "duration", "60", BASE, 375)).toEqual([{ op: "trim_clip", clipId: "i", edge: "end", to: 1900 }]);
  });
});
