import { describe, expect, it } from "vitest";
import { CROP_MIN_SHOWN, type Sizer } from "@/lib/editor/clip-box";
import {
  clipFieldOps, clipFieldValue, cropScrubRange, fieldContext, FIELD_LABEL, scrubBounds, weightOptions, type ClipField, type FieldContext,
} from "@/lib/editor/inspector-fields";
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

  it("with the lock off, Height keeps the Width in a 4K project", () => {
    const doc = sampleDoc();
    Object.assign(doc, { width: 3840, height: 2160 });
    const c1 = findClip(doc, "c1")!.clip;
    expect([c1.type, c1.transform.scale]).toEqual(["video", 1]);
    const sizer: Sizer = { source: () => ({ width: 3840, height: 2160 }), measure: () => 0 };
    const free = fieldContext(doc, c1, { units: "px", lockAspect: false }, sizer);
    expect(clipFieldValue(c1, "width", free)).toBe("3840");
    for (const raw of ["201", "204"]) {
      const ops = clipFieldOps(c1, "height", raw, free)!;
      const { transform } = (ops[0] as unknown as { patch: { transform: Record<string, number> } }).patch;
      const updated = withTransform(c1, transform);
      expect(clipFieldValue(updated, "height", free), raw).toBe(raw);
      expect(clipFieldValue(updated, "width", free), raw).toBe("3840");
    }
    // A Height so small its scale rounds to 0 gives what it always gave, not a division by zero.
    expect(clipFieldOps(c1, "height", "0.1", free)).toEqual([{ op: "update_clip", clipId: "c1", patch: { transform: { scale: 0, stretch: 21600 } } }]);
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
      room: 90, // x2 starts at frame 90
    });
    expect(fieldContext(doc, x1)).toEqual({ fps: 30, frame: { width: 1080, height: 1920 }, units: "px", box: null, lockAspect: true, room: 90 });
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
    ["scale", "100.7", patch({ transform: { scale: 1.007 } })],
    ["scale", "0.001", null],
    ["rotation", "-45", patch({ transform: { rotation: -45 } })],
    ["opacity", "140", patch({ transform: { opacity: 1 } })],
    ["opacity", "33.3", patch({ transform: { opacity: 0.333 } })],
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

describe("scrubBounds", () => {
  it("scrubBounds stops at the neighbours", () => {
    expect(scrubBounds(sampleDoc(), "x2", "start")).toEqual({ min: 2, max: Infinity });
    expect(scrubBounds(sampleDoc(), "c1", "duration")).toEqual({ min: 1 / 30, max: 1 });
  });

  it("Start stops where the clip would touch the one after it", () => {
    // x1 is 60 frames long and x2 starts at 90.
    expect(scrubBounds(sampleDoc(), "x1", "start")).toEqual({ min: 0, max: 1 });
    expect(scrubBounds(sampleDoc(), "c2", "start")).toEqual({ min: 1, max: Infinity });
  });

  it("Length stops at the end of the media when that comes first", () => {
    // c2 starts at 30 with nothing after it; a 60-frame video lets it end at 90.
    expect(scrubBounds(sampleDoc(), "c2", "duration")).toEqual({ min: 1 / 30, max: Infinity });
    expect(scrubBounds(sampleDoc(), "c2", "duration", 60)).toEqual({ min: 1 / 30, max: 2 });
    // c1 would reach c2 before the end of a 300-frame video.
    expect(scrubBounds(sampleDoc(), "c1", "duration", 300)).toEqual({ min: 1 / 30, max: 1 });
    // A clip that already runs past its media keeps one frame.
    const doc = sampleDoc();
    doc.tracks[0].clips[1] = video("c2", 30, 30, { in: 100 });
    expect(scrubBounds(doc, "c2", "duration", 60)).toEqual({ min: 1 / 30, max: 1 / 30 });
  });

  it("follows the project's rate, and an unknown clip has no limits", () => {
    const doc = { ...sampleDoc(), fps: 60 };
    expect(scrubBounds(doc, "x2", "start")).toEqual({ min: 1, max: Infinity });
    expect(scrubBounds(doc, "gone", "start")).toEqual({ min: -Infinity, max: Infinity });
  });
});

describe("crop numbers", () => {
  const crop = (c: Partial<Record<"left" | "top" | "right" | "bottom", number>>) => ({ left: 0, top: 0, right: 0, bottom: 0, ...c });
  const cropped = (c: Partial<Record<"left" | "top" | "right" | "bottom", number>>) => withTransform(clip("x1"), { crop: crop(c) });

  it("a typed side crops that side and sends all four", () => {
    expect(clipFieldOps(clip("x1"), "cropLeft", "10", BASE)).toEqual(patch({ transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } }));
    expect(clipFieldOps(cropped({ right: 0.5 }), "cropLeft", "60", BASE)).toEqual(patch({ transform: { crop: crop({ left: 0.45, right: 0.5 }) } }));
    expect(clipFieldOps(cropped({ left: 0.2 }), "cropLeft", "-5", BASE)).toEqual(patch({ transform: { crop: crop({ left: 0 }) } }));
    expect(clipFieldOps(cropped({ left: 0.1 }), "cropLeft", "10", BASE)).toEqual([]);
    expect(clipFieldOps(clip("x1"), "cropLeft", "0", BASE)).toEqual([]);
    expect(FIELD_LABEL.cropLeft).toBe("crop");
    expect([FIELD_LABEL.cropTop, FIELD_LABEL.cropRight, FIELD_LABEL.cropBottom]).toEqual(["crop", "crop", "crop"]);
  });

  it("each side leaves at least 5% against its opposite, kept to 4 places", () => {
    expect(clipFieldOps(cropped({ bottom: 0.3 }), "cropTop", "90", BASE)).toEqual(patch({ transform: { crop: crop({ top: 0.65, bottom: 0.3 }) } }));
    expect(clipFieldOps(cropped({ left: 0.25 }), "cropRight", "99", BASE)).toEqual(patch({ transform: { crop: crop({ left: 0.25, right: 0.7 }) } }));
    expect(clipFieldOps(cropped({ top: 0.1 }), "cropBottom", "12.34567", BASE)).toEqual(patch({ transform: { crop: crop({ top: 0.1, bottom: 0.1235 }) } }));
    // The other pair does not hold a side back.
    expect(clipFieldOps(cropped({ top: 0.9 }), "cropLeft", "90", BASE)).toEqual(patch({ transform: { crop: crop({ left: 0.9, top: 0.9 }) } }));
    // An opposite side past 95% leaves no room at all.
    expect(clipFieldOps(cropped({ right: 0.97 }), "cropLeft", "10", BASE)).toEqual([]);
    expect(clipFieldOps(clip("x1"), "cropLeft", "abc", BASE)).toBeNull();
    expect(clipFieldOps(clip("x1"), "cropLeft", "", BASE)).toBeNull();
  });

  it("each side shows its share in percent, to one place", () => {
    const c = cropped({ left: 0.1, top: 0.125, right: 0.3333, bottom: 0 });
    expect(["cropLeft", "cropTop", "cropRight", "cropBottom"].map((f) => clipFieldValue(c, f as ClipField, BASE))).toEqual(["10", "12.5", "33.3", "0"]);
    expect(clipFieldValue(clip("c1"), "cropTop", BASE)).toBe("0");
  });

  it("a dragged side stops where the opposite side leaves 5%", () => {
    expect(cropScrubRange(cropped({ right: 0.3 }), "cropLeft")).toEqual({ min: 0, max: 65 });
    expect(cropScrubRange(cropped({ left: 0.3 }), "cropRight")).toEqual({ min: 0, max: 65 });
    expect(cropScrubRange(cropped({ bottom: 0.125 }), "cropTop")).toEqual({ min: 0, max: 82.5 });
    expect(cropScrubRange(cropped({ top: 0.5 }), "cropBottom")).toEqual({ min: 0, max: 45 });
    expect(cropScrubRange(clip("c1"), "cropLeft")).toEqual({ min: 0, max: 95 });
    expect(cropScrubRange(cropped({ right: 0.97 }), "cropLeft")).toEqual({ min: 0, max: 0 });
    expect(CROP_MIN_SHOWN).toBe(0.05);
  });
});

describe("the font field", () => {
  const styled = (fontFamily: string, fontWeight: number) => text("x1", 0, 60, { style: { fontFamily, fontSize: 64, fontWeight, color: "#ffffff", align: "center" } });
  const update = (style: Record<string, unknown>) => [{ op: "update_clip", clipId: "x1", patch: { style } }];

  it("shows the clip's font", () => {
    expect(clipFieldValue(styled("Orbitron", 700), "fontFamily", ctx)).toBe("Orbitron");
    expect(FIELD_LABEL.fontFamily).toBe("style change");
  });

  it("changing to Bebas Neue snaps a bold clip to 400", () => {
    expect(clipFieldOps(styled("Geist", 700), "fontFamily", "Bebas Neue", ctx)).toEqual(update({ fontFamily: "Bebas Neue", fontWeight: 400 }));
  });

  it("changing to Inter keeps 700", () => {
    expect(clipFieldOps(styled("Geist", 700), "fontFamily", "Inter", ctx)).toEqual(update({ fontFamily: "Inter" }));
    expect(clipFieldOps(styled("Inter", 700), "fontFamily", "Inter", ctx)).toEqual([]);
  });

  it("an unlisted font is refused, but re-choosing the clip's own unlisted font changes nothing", () => {
    expect(clipFieldOps(styled("Geist", 700), "fontFamily", "Comic Sans MS", ctx)).toBeNull();
    expect(clipFieldOps(styled("Comic Sans MS", 700), "fontFamily", "Comic Sans MS", ctx)).toEqual([]);
  });

  it("offers only the weights the font has", () => {
    expect(weightOptions("Bebas Neue", 400)).toEqual([{ value: 400, label: "Regular" }]);
    expect(weightOptions("Lato", 400).map((w) => w.label)).toEqual(["Light", "Regular", "Bold", "Black"]);
    expect(weightOptions("Comic Sans MS", 700).map((w) => w.value)).toEqual([400, 500, 600, 700, 900]);
    expect(weightOptions("Bebas Neue", 700).map((w) => w.value)).toEqual([400, 700]); // the clip's own weight stays shown
  });
});

describe("keyframed fields", () => {
  // x1 runs from frame 0; x keyframed from 0.25 at frame 0 to 0.75 at frame 20, so 0.5 at frame 10.
  const keyed = () => ({ ...clip("x1"), keyframes: { x: [{ at: 0, value: 0.25 }, { at: 20, value: 0.75 }] } }) as Clip;
  const at = (playhead: number): FieldContext => ({ ...ctx, playhead });

  it("show the value at the playhead", () => {
    expect(clipFieldValue(keyed(), "x", at(10))).toBe("540");
    expect(clipFieldValue(keyed(), "x", at(20))).toBe("810");
    // Without a playhead the field reads the transform, as before.
    expect(clipFieldValue(keyed(), "x", ctx)).toBe("540");
    expect(clipFieldValue(withTransform(keyed(), { x: 0.1 }), "x", ctx)).toBe("108");
  });

  it("a typed X on a keyframed clip writes a keyframe at the playhead, not transform.x", () => {
    expect(clipFieldOps(keyed(), "x", "324", at(10))).toEqual(
      patch({ keyframes: { x: [{ at: 0, value: 0.25 }, { at: 10, value: 0.3 }, { at: 20, value: 0.75 }] } }),
    );
    // Y is not keyframed and still goes to the transform.
    expect(clipFieldOps(keyed(), "y", "1440", at(10))).toEqual(patch({ transform: { y: 0.75 } }));
  });

  it("scale, rotation and opacity keyframe alike, and Width reads the keyframed scale", () => {
    const c = { ...clip("x1"), keyframes: { scale: [{ at: 0, value: 2 }], rotation: [{ at: 0, value: 0 }], opacity: [{ at: 0, value: 1 }] } } as Clip;
    expect(clipFieldOps(c, "scale", "50", at(5))).toEqual(patch({ keyframes: { scale: [{ at: 0, value: 2 }, { at: 5, value: 0.5 }] } }));
    expect(clipFieldOps(c, "rotation", "45", at(5))).toEqual(patch({ keyframes: { rotation: [{ at: 0, value: 0 }, { at: 5, value: 45 }] } }));
    expect(clipFieldOps(c, "opacity", "40", at(0))).toEqual(patch({ keyframes: { opacity: [{ at: 0, value: 0.4 }] } }));
    expect(clipFieldValue(c, "scale", at(5))).toBe("200");
    expect(clipFieldValue(c, "width", at(5))).toBe("128");
    // Locked, Width changes the scale, so it keyframes too.
    expect(clipFieldOps(c, "width", "64", at(5))).toEqual(patch({ keyframes: { scale: [{ at: 0, value: 2 }, { at: 5, value: 1 }] } }));
  });

  it("a playhead outside the clip edits at its nearest frame", () => {
    const x2 = { ...clip("x2"), keyframes: { x: [{ at: 0, value: 0.5 }] } } as Clip; // 90 to 120
    expect(clipFieldOps(x2, "x", "108", at(200))).toEqual([
      { op: "update_clip", clipId: "x2", patch: { keyframes: { x: [{ at: 0, value: 0.5 }, { at: 29, value: 0.1 }] } } },
    ]);
  });

  it("fieldContext takes the playhead", () => {
    const doc = sampleDoc();
    expect(fieldContext(doc, findClip(doc, "x1")!.clip, undefined, null, 12).playhead).toBe(12);
    expect(fieldContext(doc, findClip(doc, "x1")!.clip)).not.toHaveProperty("playhead");
  });
});
