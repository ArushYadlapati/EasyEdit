// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { TextClip } from "@/lib/timeline";
import { text } from "../editor/fixtures";
import { renderHook } from "../helpers/dom";

const hi = text("t", 0, 30) as TextClip; // "hi", 700 weight, 64 px Geist

// Each test takes a fresh copy of the module, so its one shared context is made anew.
async function freshMeasure() {
  vi.resetModules();
  const { useTextMeasure } = await import("@/components/editor/text-measure");
  return { useTextMeasure, measure: renderHook(() => useTextMeasure()).result.current };
}

afterEach(() => vi.restoreAllMocks());

it("measures in the clip's font on one shared context, made on the first measure", async () => {
  const fonts: string[] = [];
  const fake = {
    set font(value: string) {
      fonts.push(value);
    },
    measureText: (s: string) => ({ width: s.length * 10 }),
  };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => fake) as never);
  const { useTextMeasure, measure } = await freshMeasure();
  expect(getContext).not.toHaveBeenCalled();
  expect(measure(hi, "hello")).toBe(50);
  expect(measure({ ...hi, style: { ...hi.style, fontFamily: "Lobster", fontWeight: 400, fontSize: 30 } }, "a")).toBe(10);
  expect(fonts).toEqual(['700 64px "Geist", sans-serif', '400 30px "Lobster", sans-serif']);
  expect(getContext).toHaveBeenCalledTimes(1);
  // The same function on every render.
  const { result, rerender } = renderHook(() => useTextMeasure());
  const first = result.current;
  rerender();
  expect(result.current).toBe(first);
  expect(first).toBe(measure);
});

it("without a 2D context, each character is half the font size wide", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => null) as never);
  const { measure } = await freshMeasure();
  expect(measure(hi, "hello")).toBe(160);
});
