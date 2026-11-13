import { describe, expect, it } from "vitest";
import { PLACEHOLDER_FILL, activeClips, cropRect, drawFrame, fitRect, mediaSize, type LocalRect } from "@/lib/render/compositor";
import { SAFE_ZONES } from "@/lib/render/safe-zones";
import { layoutText, wrapLines } from "@/lib/render/text-layout";
import { DEFAULT_TRANSFORM, NO_CROP, createEmptyDoc, type Clip, type MediaClip, type TextClip, type TimelineDoc } from "@/lib/timeline";
import { text, video } from "../editor/fixtures";
import { fakeCtx, type Call } from "./fake-ctx";

const only = (calls: Call[], ...names: string[]) => calls.filter(([name]) => names.includes(name));
function textDoc(...clips: Clip[]): TimelineDoc {
  const d = createEmptyDoc("short_9x16"); // 1080 × 1920
  d.tracks[1].clips = clips;
  return d;
}
const tenPerChar = (s: string) => s.length * 10;

describe("text layout", () => {
  it("wraps at spaces, cuts a word that is too long, and keeps blank lines", () => {
    expect(wrapLines("go solvers go", 50, tenPerChar)).toEqual(["go", "solve", "rs go"]);
    expect(wrapLines("a\n\nb", 50, tenPerChar)).toEqual(["a", "", "b"]);
    expect(wrapLines("one two", 1000, tenPerChar)).toEqual(["one two"]);
    expect(wrapLines("a\r\nb", 50, tenPerChar)).toEqual(["a", "b"]);
  });

  it("centers the block on the clip and aligns lines inside a box 90% of the frame wide", () => {
    const clip = text("x", 0, 30, { text: "A\nB", style: { fontFamily: "Geist", fontSize: 100, fontWeight: 700, color: "#ffffff", align: "center" } }) as TextClip;
    expect(layoutText(clip, 1080, tenPerChar)).toEqual([{ text: "A", x: 0, y: -60 }, { text: "B", x: 0, y: 60 }]);
    expect(layoutText({ ...clip, style: { ...clip.style, align: "left" } }, 1080, tenPerChar).map((l) => l.x)).toEqual([-486, -486]);
    expect(layoutText({ ...clip, style: { ...clip.style, align: "right" } }, 1080, tenPerChar).map((l) => l.x)).toEqual([486, 486]);
  });
});

describe("drawFrame", () => {
  it("paints black, then a text clip with its transform and style", () => {
    const { ctx, calls } = fakeCtx();
    const clip = text("x", 0, 30, { transform: { ...DEFAULT_TRANSFORM, y: 0.25, scale: 2, rotation: 90, opacity: 0.5 } });
    drawFrame(ctx, textDoc(clip), 10);
    expect(calls).toEqual([
      ["set fillStyle", "#000000"], ["fillRect", 0, 0, 1080, 1920],
      ["save"], ["set globalAlpha", 0.5], ["translate", 540, 480], ["rotate", Math.PI / 2], ["scale", 2, 2],
      ["set font", '700 64px "Geist", sans-serif'], ["set fillStyle", "#ffffff"], ["set textAlign", "center"], ["set textBaseline", "middle"],
      ["fillText", "hi", 0, 0],
      ["restore"],
    ]);
  });

  it("draws a stretched clip wider for its height, and keeps the wrapping", () => {
    const { ctx, calls } = fakeCtx();
    const clip = text("x", 0, 30, { text: "seattle solvers robotics team wins", transform: { ...DEFAULT_TRANSFORM, scale: 2, stretch: 1.5 } });
    drawFrame(ctx, textDoc(clip), 0);
    expect(only(calls, "scale")).toEqual([["scale", 3, 2]]);
    expect(only(calls, "fillText")).toEqual([["fillText", "seattle solvers robotics team", 0, -38.4], ["fillText", "wins", 0, 38.4]]);
    const narrow = fakeCtx();
    drawFrame(narrow.ctx, textDoc(text("x", 0, 30, { transform: { ...DEFAULT_TRANSFORM, stretch: 0.5 } })), 0);
    expect(only(narrow.calls, "scale")).toEqual([["scale", 0.5, 1]]);
  });

  it("wraps long text with the real font size, and asks the font resolver for the family", () => {
    const { ctx, calls } = fakeCtx(); // 64 px text measures 32 px per character; the box is 972 px, so 30 characters fit
    drawFrame(ctx, textDoc(text("x", 0, 30, { text: "seattle solvers robotics team wins" })), 0, { resolveFont: (family) => `"Loaded ${family}"` });
    expect(only(calls, "set font")).toEqual([["set font", '700 64px "Loaded Geist"']]);
    expect(only(calls, "fillText")).toEqual([["fillText", "seattle solvers robotics team", 0, -38.4], ["fillText", "wins", 0, 38.4]]);
  });

  it("hideClipId leaves that clip out", () => {
    const shown = text("x0", 0, 30, { text: "kept" });
    const doc = textDoc(shown, text("x1", 0, 30, { text: "typed" }));
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc, 0, { hideClipId: "x1" });
    expect(only(calls, "fillText")).toEqual([["fillText", "kept", 0, 0]]);
    const all = fakeCtx();
    drawFrame(all.ctx, doc, 0);
    expect(only(all.calls, "fillText").map(([, s]) => s)).toEqual(["kept", "typed"]);
  });

  it("draws only the clips under the playhead, on visible tracks, later tracks on top", () => {
    const d = textDoc(text("a", 0, 30, { text: "below" }), text("b", 30, 30, { text: "later" }));
    d.tracks.push({ id: "t2", kind: "text", name: "Text 2", muted: false, hidden: false, locked: false, clips: [text("c", 0, 30, { text: "above" })] });
    const drawn = (frame: number) => {
      const { ctx, calls } = fakeCtx();
      drawFrame(ctx, d, frame);
      return only(calls, "fillText").map((call) => call[1]);
    };
    expect([drawn(0), drawn(29), drawn(30), drawn(60)]).toEqual([["below", "above"], ["below", "above"], ["later"], []]);
    d.tracks[1].hidden = true;
    expect(drawn(0)).toEqual(["above"]);
    expect(activeClips(d, 0).map((a) => a.clip.id)).toEqual(["c"]);
  });

  it("draws a labeled placeholder for video and image, and nothing for audio", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("v", 0, 30)];
    d.tracks[3].clips = [video("s", 0, 30, { type: "audio" })];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 0);
    expect(only(calls, "set fillStyle", "fillRect", "set font", "fillText")).toEqual([
      ["set fillStyle", "#000000"], ["fillRect", 0, 0, 1080, 1920],
      ["set fillStyle", PLACEHOLDER_FILL.video], ["fillRect", -540, -960, 1080, 1920],
      ["set fillStyle", "#ededed"], ["set font", "500 43px sans-serif"], ["fillText", "Video", 0, 0],
    ]);
  });

  it("draws a resolved source to cover or contain the frame", () => {
    expect(fitRect(1920, 1080, 1080, 1920, "contain")).toEqual({ width: 1080, height: 607.5 });
    const cover = fitRect(1920, 1080, 1080, 1920, "cover");
    expect([Math.round(cover.width), Math.round(cover.height)]).toEqual([3413, 1920]);
    const image = {} as CanvasImageSource;
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("v", 0, 30, { type: "image" })];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 0, { resolveSource: (clip) => (clip.assetId === "a" ? { image, width: 1920, height: 1080 } : null) });
    const [draw] = only(calls, "drawImage");
    expect(draw[1]).toBe(image);
    expect((draw.slice(2) as number[]).map(Math.round)).toEqual([-1707, -960, 3413, 1920]);
    expect(only(calls, "fillText")).toEqual([]);
  });
});

describe("the media seam", () => {
  const texts = (calls: Call[]) => only(calls, "fillText").map((c) => c[1]);

  it("asks for a source with the clip and the frame, so two clips of one asset can differ", () => {
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { in: 300 })];
    const asked: [string, string, number, number][] = [];
    const resolveSource = (clip: MediaClip, frame: number) => { asked.push([clip.id, clip.assetId, clip.in, frame]); return null; };
    drawFrame(fakeCtx().ctx, doc, 10, { resolveSource });
    drawFrame(fakeCtx().ctx, doc, 40, { resolveSource });
    expect(asked).toEqual([["c1", "a", 0, 10], ["c2", "a", 300, 40]]);
  });

  it("a clip with no picture says what its label says", () => {
    const { ctx, calls } = fakeCtx();
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 30)];
    drawFrame(ctx, doc, 0, { resolveSource: () => null, placeholderLabel: () => "Preparing preview" });
    expect(texts(calls)).toEqual(["Preparing preview"]);
  });

  it("says Video or Image when no label is given", () => {
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { type: "image" })];
    const first = fakeCtx();
    drawFrame(first.ctx, doc, 0);
    expect(texts(first.calls)).toEqual(["Video"]);
    const second = fakeCtx();
    drawFrame(second.ctx, doc, 30);
    expect(texts(second.calls)).toEqual(["Image"]);
  });
});

describe("drawFrame with an empty source", () => {
  it("draws the placeholder when the resolved source has no size", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("v", 0, 30)];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 0, { resolveSource: () => ({ image: {} as CanvasImageSource, width: 0, height: 1080 }) });
    expect(only(calls, "drawImage")).toEqual([]);
    expect(only(calls, "fillText")).toEqual([["fillText", "Video", 0, 0]]);
  });
});

describe("crop", () => {
  const CUT = { left: 0.1, top: 0, right: 0.2, bottom: 0 };
  const closeTo = (actual: unknown[], expected: number[]) => {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((v, i) => expect(actual[i] as number, String(i)).toBeCloseTo(v, 6));
  };
  const closeRect = (rect: LocalRect, expected: Partial<LocalRect>) => {
    for (const [side, value] of Object.entries(expected)) expect(rect[side as keyof LocalRect], side).toBeCloseTo(value, 6);
  };
  const imageDoc = (transform: Record<string, unknown>) => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("v", 0, 30, { type: "image", transform: { ...DEFAULT_TRANSFORM, fit: "contain", ...transform } })];
    return d;
  };
  const image = {} as CanvasImageSource;
  const source = () => ({ image, width: 200, height: 100 });

  it("mediaSize fits the source, or fills the frame for a placeholder", () => {
    const doc = { width: 1080, height: 1920 };
    const clip = video("v", 0, 30, { transform: { ...DEFAULT_TRANSFORM, fit: "contain" } }) as MediaClip;
    expect(mediaSize(doc, clip, null)).toEqual({ width: 1080, height: 1920 });
    expect(mediaSize(doc, clip, { width: 0, height: 0 })).toEqual({ width: 1080, height: 1920 });
    expect(mediaSize(doc, clip, { width: 1920, height: 0 })).toEqual({ width: 1080, height: 1920 });
    const fitted = mediaSize(doc, clip, { width: 1920, height: 1080 });
    expect(fitted.width).toBeCloseTo(1080, 6);
    expect(fitted.height).toBeCloseTo(607.5, 6);
  });

  it("cropRect cuts shares of any box", () => {
    closeRect(cropRect({ left: -540, top: -270, right: 540, bottom: 270 }, CUT), { left: -432, top: -270, right: 324, bottom: 270 });
    closeRect(cropRect({ left: -486, top: -38.4, right: -422, bottom: 38.4 }, { left: 0.5, top: 0, right: 0, bottom: 0 }), { left: -454, top: -38.4, right: -422, bottom: 38.4 });
    closeRect(cropRect({ left: -100, top: -50, right: 100, bottom: 50 }, { left: 0, top: 0.1, right: 0, bottom: 0.3 }), { left: -100, top: -40, right: 100, bottom: 20 });
    expect(cropRect({ left: -1, top: -2, right: 3, bottom: 4 }, undefined)).toEqual({ left: -1, top: -2, right: 3, bottom: 4 });
  });

  it("a cropped image draws the kept part in place", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, imageDoc({ crop: CUT }), 0, { resolveSource: source });
    const [draw] = only(calls, "drawImage");
    expect(draw[1]).toBe(image);
    closeTo(draw.slice(2), [20, 0, 140, 100, -432, -270, 756, 540]);
    const { ctx: c2, calls: tall } = fakeCtx();
    drawFrame(c2, imageDoc({ crop: { left: 0, top: 0.25, right: 0, bottom: 0.5 } }), 0, { resolveSource: source });
    closeTo(only(tall, "drawImage")[0].slice(2), [0, 25, 200, 25, -540, -135, 1080, 135]);
  });

  it("no crop and NO_CROP keep the plain call", () => {
    for (const transform of [{}, { crop: { ...NO_CROP } }]) {
      const { ctx, calls } = fakeCtx();
      drawFrame(ctx, imageDoc(transform), 0, { resolveSource: source });
      const draws = only(calls, "drawImage");
      expect(draws).toHaveLength(1);
      closeTo(draws[0].slice(2), [-540, -270, 1080, 540]);
      expect(only(calls, "clip", "rect")).toEqual([]);
    }
  });

  it("a cropped placeholder fills only the kept part", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, imageDoc({ crop: CUT }), 0);
    const fills = only(calls, "fillRect");
    expect(fills).toHaveLength(2);
    expect(fills[1][0]).toBe("fillRect");
    closeTo(fills[1].slice(1), [-432, -960, 756, 1920]);
    const [label] = only(calls, "fillText");
    expect(label[1]).toBe("Image");
    closeTo(label.slice(2), [-54, 0]);
    expect(only(calls, "drawImage")).toEqual([]);
  });

  it("a placeholder for a source with no size is cropped too", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, imageDoc({ crop: CUT }), 0, { resolveSource: () => ({ image, width: 200, height: 0 }) });
    closeTo(only(calls, "fillRect")[1].slice(1), [-432, -960, 756, 1920]);
    expect(only(calls, "drawImage")).toEqual([]);
  });

  it("a cropped text clips to the kept part", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, textDoc(text("x1", 0, 30, { transform: { ...DEFAULT_TRANSFORM, crop: { left: 0.25, top: 0, right: 0, bottom: 0 } } })), 0);
    const start = calls.findIndex(([name]) => name === "beginPath");
    expect(start).toBeGreaterThan(-1);
    const [begin, rect, clip, fill] = calls.slice(start, start + 4);
    expect(begin).toEqual(["beginPath"]);
    expect(rect[0]).toBe("rect");
    closeTo(rect.slice(1), [-16, -102.4, 112, 204.8]);
    expect(clip).toEqual(["clip"]);
    expect(fill).toEqual(["fillText", "hi", 0, 0]);
    expect(calls.findIndex(([name]) => name === "restore")).toBeGreaterThan(start);
    expect(calls.findIndex(([name]) => name === "save")).toBeLessThan(start);
  });

  it("a text cut on every side clips at each cut", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, textDoc(text("x1", 0, 30, { transform: { ...DEFAULT_TRANSFORM, crop: { left: 0.25, top: 0.25, right: 0.25, bottom: 0.25 } } })), 0);
    closeTo(only(calls, "rect")[0].slice(1), [-16, -19.2, 32, 38.4]);
  });

  it("uncropped text makes no clip call", () => {
    for (const transform of [{ ...DEFAULT_TRANSFORM }, { ...DEFAULT_TRANSFORM, crop: { ...NO_CROP } }]) {
      const { ctx, calls } = fakeCtx();
      drawFrame(ctx, textDoc(text("x1", 0, 30, { transform })), 0);
      expect(only(calls, "beginPath", "rect", "clip")).toEqual([]);
      expect(only(calls, "fillText")).toEqual([["fillText", "hi", 0, 0]]);
    }
  });
});

describe("safe zones", () => {
  it("has margins for every format", () => {
    expect(SAFE_ZONES.short_9x16).toEqual({ top: 0.14, right: 0.06, bottom: 0.35, left: 0.06, label: "Reels and Shorts safe area" });
    for (const format of ["feed_4x5", "square_1x1", "long_16x9", "long_4k"] as const) {
      expect(SAFE_ZONES[format]).toEqual({ top: 0.05, right: 0.05, bottom: 0.05, left: 0.05, label: "Safe area" });
    }
  });
});
