import { expect, it } from "vitest";
import { MIN_STILL_PX, sampleBackdrop } from "@/lib/editor/clip-look";
import { cssFontFamily } from "@/lib/editor/fonts";

it("a text sample names the app's own fonts by their variables, and any other font by name", () => {
  expect(cssFontFamily("Geist")).toBe("var(--font-geist-sans)");
  expect(cssFontFamily("Geist Mono")).toBe("var(--font-geist-mono)");
  expect(cssFontFamily("Comic Sans MS")).toBe('"Comic Sans MS", sans-serif');
  expect(cssFontFamily("toString")).toBe('"toString", sans-serif'); // not a font the app loads, whatever objects have
});

it("a light color gets the dark backdrop and a dark color the light one", () => {
  expect(sampleBackdrop("#ffffff")).toBe("dark");
  expect(sampleBackdrop("#fff")).toBe("dark");
  expect(sampleBackdrop("#000000")).toBe("light");
  expect(sampleBackdrop("#1e3a8a")).toBe("light");
  expect(sampleBackdrop("#ff0000")).toBe("dark");
  expect(sampleBackdrop("#000")).toBe("light");
  expect(sampleBackdrop("#1E3A8A")).toBe("light");
  // The turn is at a relative luminance of 0.18, with green weighed most and blue least.
  expect(sampleBackdrop("#767676")).toBe("dark"); // 0.181
  expect(sampleBackdrop("#757575")).toBe("light"); // 0.178
  expect(sampleBackdrop("#00ff00")).toBe("dark");
  expect(sampleBackdrop("#0000ff")).toBe("light");
});

it("a color it cannot read gets the dark backdrop", () => {
  for (const color of ["red", "", "#00", "#0000", "#00000000", "000000", "#00000g", "rgb(0, 0, 0)"]) expect(sampleBackdrop(color), color).toBe("dark");
});

it("the still is dropped under 120 px", () => {
  expect(MIN_STILL_PX).toBe(120);
});
