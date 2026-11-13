import { expect, it } from "vitest";
import { convertDraft, draftFor, draftPixels, pixelLine, ratioOf, sizeCaption, swapDraft } from "@/lib/dashboard/size-draft";

it("a draft becomes even pixels", () => {
  expect(draftPixels({ units: "px", width: "1080", height: "1920" })).toEqual({ width: 1080, height: 1920 });
  expect(draftPixels({ units: "in", width: "4", height: "6" })).toEqual({ width: 384, height: 576 });
  expect(draftPixels({ units: "in", width: "8.5", height: "11" })).toEqual({ width: 816, height: 1056 });
  expect(draftPixels({ units: "cm", width: "10", height: "15" })).toEqual({ width: 378, height: 566 });
  expect(draftPixels({ units: "px", width: "1081", height: "1920" })).toEqual({ width: 1082, height: 1920 });
  expect(draftPixels({ units: "in", width: ".5", height: "1" })).toEqual({ width: 48, height: 96 });
  expect(draftPixels({ units: "px", width: " 1080 ", height: "1920." })).toEqual({ width: 1080, height: 1920 });
  expect(draftPixels({ units: "px", width: "", height: "1920" })).toBeNull();
  expect(draftPixels({ units: "px", width: "abc", height: "1920" })).toBeNull();
  expect(draftPixels({ units: "px", width: "-4", height: "10" })).toBeNull();
  expect(draftPixels({ units: "px", width: "1080", height: "" })).toBeNull();
  expect(draftPixels({ units: "px", width: "1e3", height: "1920" })).toBeNull();
  // Limits are checked by the caller, not here.
  expect(draftPixels({ units: "px", width: "8000", height: "8000" })).toEqual({ width: 8000, height: 8000 });
});

it("a size shown in a unit, converted and swapped", () => {
  expect(draftFor({ width: 1080, height: 1920 }, "in")).toEqual({ units: "in", width: "11.25", height: "20" });
  expect(draftFor({ width: 1080, height: 1920 }, "px")).toEqual({ units: "px", width: "1080", height: "1920" });
  expect(convertDraft({ units: "px", width: "816", height: "1056" }, "in")).toEqual({ units: "in", width: "8.5", height: "11" });
  expect(convertDraft({ units: "in", width: "4", height: "6" }, "px")).toEqual({ units: "px", width: "384", height: "576" });
  expect(convertDraft({ units: "px", width: "", height: "1056" }, "in")).toEqual({ units: "in", width: "", height: "11" });
  expect(convertDraft({ units: "px", width: "1081", height: "x" }, "px")).toEqual({ units: "px", width: "1082", height: "x" });
  expect(swapDraft({ units: "px", width: "1080", height: "1920" })).toEqual({ units: "px", width: "1920", height: "1080" });
});

it("a ratio only when both terms are 32 or less", () => {
  expect(ratioOf({ width: 1080, height: 1920 })).toBe("9:16");
  expect(ratioOf({ width: 816, height: 1056 })).toBe("17:22");
  expect(ratioOf({ width: 384, height: 576 })).toBe("2:3");
  expect(ratioOf({ width: 3840, height: 2160 })).toBe("16:9");
  expect(ratioOf({ width: 1000, height: 1080 })).toBe("25:27");
  expect(ratioOf({ width: 1000, height: 998 })).toBeNull();
  expect(ratioOf({ width: 64, height: 66 })).toBeNull(); // 32:33
  expect(ratioOf({ width: 66, height: 64 })).toBeNull(); // 33:32
  expect(ratioOf({ width: 1024, height: 1024 })).toBe("1:1");
  expect(ratioOf({ width: 3200, height: 900 })).toBe("32:9");
  expect(ratioOf({ width: 900, height: 3200 })).toBe("9:32");
});

it("the caption under the preview", () => {
  expect(sizeCaption({ width: 1080, height: 1920 }, "px")).toBe("1080 × 1920 px · 9:16");
  expect(sizeCaption({ width: 384, height: 576 }, "in")).toBe("4 × 6 in · 384 × 576 px · 2:3");
  expect(sizeCaption({ width: 378, height: 566 }, "cm")).toBe("10 × 14.98 cm · 378 × 566 px");
  expect(sizeCaption({ width: 1000, height: 998 }, "px")).toBe("1000 × 998 px");
  expect(pixelLine({ width: 816, height: 1056 })).toBe("816 × 1056 pixels");
});
