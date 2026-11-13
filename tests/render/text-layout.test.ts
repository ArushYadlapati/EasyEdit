import { describe, expect, it } from "vitest";
import { textRect, type LocalRect } from "@/lib/render/text-layout";
import type { TextClip } from "@/lib/timeline";
import { text } from "../editor/fixtures";

// "hi" at 64 px in a 1080-wide frame; text measures half its font size per character.
const measure = (s: string) => (s.length * 64) / 2;
const clipWith = (over: { text?: string; align?: "left" | "center" | "right" }) => {
  const clip = text("x", 0, 30, over.text === undefined ? {} : { text: over.text }) as TextClip;
  return { ...clip, style: { ...clip.style, align: over.align ?? "center" } };
};
const close = (rect: LocalRect, expected: Partial<LocalRect>) => {
  for (const [side, value] of Object.entries(expected)) expect(rect[side as keyof LocalRect], side).toBeCloseTo(value, 6);
};

describe("textRect", () => {
  it("is the measured box around centred text", () => {
    close(textRect(clipWith({}), 1080, measure), { left: -32, top: -38.4, right: 32, bottom: 38.4 });
  });

  it("starts at the anchor for left text and ends there for right text", () => {
    close(textRect(clipWith({ align: "left" }), 1080, measure), { left: -486, right: -422 });
    close(textRect(clipWith({ align: "right" }), 1080, measure), { left: 422, right: 486 });
  });

  it("spans every line", () => {
    close(textRect(clipWith({ text: "a\nb" }), 1080, measure), { top: -76.8, bottom: 76.8 });
  });

  it("takes the widest line", () => {
    close(textRect(clipWith({ text: "a\nlong" }), 1080, measure), { left: -64, right: 64 });
    close(textRect(clipWith({ text: "a\nlong", align: "left" }), 1080, measure), { left: -486, right: -358 });
  });

  it("gives empty text half its font size around the anchor", () => {
    close(textRect(clipWith({ text: "" }), 1080, measure), { left: -16, right: 16, top: -38.4, bottom: 38.4 });
    close(textRect(clipWith({ text: "", align: "left" }), 1080, measure), { left: -502, right: -470 });
  });
});
