import { describe, expect, it } from "vitest";
import { DECODE_SIDE_MAX, clipSizes, neededSize } from "@/lib/export/needed-size";
import type { Transform } from "@/lib/timeline";
import { video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";

const TALL = { width: 1080, height: 1920 };
const WIDE = { width: 1920, height: 1080 };
const UHD = { width: 3840, height: 2160 };
const COPY = { width: 1280, height: 720 }; // a landscape 720p preview copy

const t = (over: Partial<Transform> = {}): Transform =>
  ({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, fit: "cover", ...over }) as Transform;

describe("neededSize: the decode size at which no source pixel is drawn larger than one export pixel", () => {
  it.each([
    // [what, doc, output, transform, source, size]
    ["cover, landscape 4K into a portrait export: drawn 1920 tall", TALL, TALL, t(), UHD, { width: 3414, height: 1920 }],
    ["contain, landscape 4K into a portrait export: drawn 1080 wide", TALL, TALL, t({ fit: "contain" }), UHD, { width: 1080, height: 608 }],
    ["cover, landscape 4K into a landscape export", WIDE, WIDE, t(), UHD, { width: 1920, height: 1080 }],
    ["the draft size needs a smaller picture than the project", WIDE, { width: 1280, height: 720 }, t(), UHD, { width: 1280, height: 720 }],
    ["portrait source, cover, into a landscape export: drawn 1920 wide", WIDE, WIDE, t(), { width: 1080, height: 1920 }, { width: 1080, height: 1920 }],
    ["scale 2 doubles the need", WIDE, WIDE, t({ scale: 2 }), UHD, { width: 3840, height: 2160 }],
    ["scale 1.5 on a 4K source", WIDE, WIDE, t({ scale: 1.5 }), UHD, { width: 2880, height: 1620 }],
    ["scale 0.3 (picture in picture) needs less than the copy", WIDE, WIDE, t({ scale: 0.3 }), COPY, { width: 576, height: 324 }],
    ["stretch 2 doubles the width's need, so the whole picture", WIDE, WIDE, t({ stretch: 2 }), UHD, { width: 3840, height: 2160 }],
    ["stretch 0.5 narrows the width; the height still needs its pixels", WIDE, WIDE, t({ stretch: 0.5 }), UHD, { width: 1920, height: 1080 }],
    // A crop draws the kept share of the source into the same share of the box (compositor.ts drawMedia), so each kept
    // source pixel lands at the same size as uncropped: it needs no more pixels.
    ["a crop needs no more pixels", WIDE, WIDE, t({ crop: { left: 0.25, top: 0.1, right: 0.25, bottom: 0.1 } }), UHD, { width: 1920, height: 1080 }],
    ["never more than the source has: a 720p copy under cover in a portrait export", TALL, TALL, t(), COPY, COPY],
    ["never more than the source has: zoomed in", WIDE, WIDE, t({ scale: 3 }), UHD, UHD],
    ["a huge photo zoomed in stops at the hard cap", TALL, TALL, t({ scale: 3 }), { width: 8000, height: 6000 }, { width: DECODE_SIDE_MAX, height: 3072 }],
    ["never less than one pixel", WIDE, WIDE, t({ scale: 0.0001 }), COPY, { width: 1, height: 1 }],
    // An output whose axes are not scaled alike (rotation can turn one into the other): the larger is taken.
    ["the larger of the output's two scales", { width: 1000, height: 1000 }, { width: 2000, height: 1000 }, t(), { width: 4000, height: 4000 }, { width: 2000, height: 2000 }],
  ])("%s", (_what, doc, output, transform, source, size) => {
    expect(neededSize(doc, transform, output, source)).toEqual(size);
  });

  it("an image zoomed in on a portrait export used to be decoded at the export's long side, and upscaled", () => {
    // A 4000 × 3000 photo, cover, scale 2, in a 1080 × 1920 export: drawn 5120 × 3840. The old rule gave 1920 × 1440.
    expect(neededSize(TALL, t({ scale: 2 }), TALL, { width: 4000, height: 3000 })).toEqual({ width: 4000, height: 3000 });
  });

  it("the hard cap is 4096", () => {
    expect(DECODE_SIDE_MAX).toBe(4096);
  });
});

describe("clipSizes", () => {
  it("answers each media clip of the doc by its own transform", () => {
    const doc = docWithCaptions("short_9x16"); // 1080 × 1920
    doc.tracks[0].clips = [video("big", 0, 10, { transform: t({ scale: 2 }) }), video("small", 0, 10, { type: "image", transform: t({ scale: 0.25 }) })];
    const sizeOf = clipSizes(doc, TALL);
    expect(sizeOf("big", UHD)).toEqual({ width: 3840, height: 2160 });
    expect(sizeOf("small", UHD)).toEqual({ width: 854, height: 480 });
  });

  it("a clip with keyframed scale is decoded at its largest keyframe, not its transform's scale", () => {
    const doc = docWithCaptions("short_9x16"); // 1080 × 1920
    const keyframes = { scale: [{ at: 0, value: 0.5 }, { at: 9, value: 1.5, ease: "ease_out" as const }] };
    doc.tracks[0].clips = [video("kb", 0, 10, { transform: t({ scale: 0.5 }), keyframes })];
    // Cover draws 2160 → 1920 tall; at 1.5 that is 2880 tall, so the whole 4K source.
    expect(clipSizes(doc, TALL)("kb", UHD)).toEqual({ width: 3840, height: 2160 });
  });

  it("a zoom transition asks for its extra scale; a fade does not", () => {
    const doc = docWithCaptions("short_9x16");
    doc.tracks[0].clips = [
      video("zoom", 0, 10, { transform: t({ scale: 0.5 }), transitionIn: { kind: "zoom", frames: 5 } }),
      video("fade", 10, 10, { assetId: "b", transform: t({ scale: 0.5 }), transitionOut: { kind: "fade", frames: 5 } }),
    ];
    const sizeOf = clipSizes(doc, TALL);
    expect(sizeOf("zoom", UHD)).toEqual({ width: 2134, height: 1200 }); // 1920 × 0.5 × 1.25 = 1200 tall
    expect(sizeOf("fade", UHD)).toEqual({ width: 1707, height: 960 });
  });

  it("a clip the doc does not have keeps the old rule: the output's long side", () => {
    const doc = docWithCaptions("short_9x16");
    expect(clipSizes(doc, TALL)("nope", UHD)).toEqual({ width: 1920, height: 1080 });
  });
});
