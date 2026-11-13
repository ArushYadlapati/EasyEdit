import { describe, expect, it } from "vitest";
import { clipRects, type Sizer } from "@/lib/editor/clip-box";
import { findClip } from "@/lib/editor/store";
import type { Clip, MediaClip, TextClip } from "@/lib/timeline";
import { sampleDoc, text, video } from "./fixtures";

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const halfFont = (clip: TextClip, s: string) => (s.length * clip.style.fontSize) / 2;
const sizer = (source: { width: number; height: number } | null = null): Sizer => ({ source: () => source, measure: halfFont });

function expectRect(actual: { left: number; top: number; right: number; bottom: number } | undefined, expected: ReturnType<typeof rect>) {
  expect(actual).toBeDefined();
  for (const side of ["left", "top", "right", "bottom"] as const) expect(actual![side]).toBeCloseTo(expected[side], 6);
}

describe("a clip's full and kept box", () => {
  it("a video without a source fills the frame", () => {
    const doc = sampleDoc();
    const rects = clipRects(doc, findClip(doc, "c1")!.clip, sizer());
    expectRect(rects?.full, rect(-540, -960, 540, 960));
    expectRect(rects?.kept, rect(-540, -960, 540, 960));
  });

  it("an image is fitted to the frame, then cut", () => {
    const doc = sampleDoc();
    const base = video("i", 0, 30, { type: "image" }) as MediaClip;
    const image = { ...base, transform: { ...base.transform, fit: "contain", crop: { left: 0.1, top: 0, right: 0.2, bottom: 0 } } } as Clip;
    const rects = clipRects(doc, image, sizer({ width: 200, height: 100 }));
    expectRect(rects?.full, rect(-540, -270, 540, 270));
    expectRect(rects?.kept, rect(-432, -270, 324, 270));
  });

  it("text is measured in its font, then cut", () => {
    const doc = sampleDoc();
    const x1 = findClip(doc, "x1")!.clip as TextClip;
    const cropped = { ...x1, transform: { ...x1.transform, crop: { left: 0.5, top: 0, right: 0, bottom: 0 } } };
    const rects = clipRects(doc, cropped, sizer());
    expectRect(rects?.full, rect(-32, -38.4, 32, 38.4));
    expectRect(rects?.kept, rect(0, -38.4, 32, 38.4));
  });

  it("the source is asked for the clip itself, and the measure gets the clip and each line", () => {
    const doc = sampleDoc();
    const seen: string[] = [];
    const watching: Sizer = {
      source: (clip) => {
        seen.push(`source ${clip.id}`);
        return null;
      },
      measure: (clip, s) => {
        seen.push(`measure ${clip.id} ${s}`);
        return halfFont(clip, s);
      },
    };
    clipRects(doc, findClip(doc, "c2")!.clip, watching);
    clipRects(doc, text("t", 0, 30, { text: "go" }), watching);
    expect(seen[0]).toBe("source c2");
    expect(seen.slice(1).every((s) => s.startsWith("measure t "))).toBe(true);
    expect(seen).toContain("measure t go");
  });

  it("audio has no box", () => {
    const doc = sampleDoc();
    const audio = video("au", 0, 30, { type: "audio" });
    expect(clipRects(doc, audio, sizer())).toBeNull();
  });
});
