import { describe, expect, it } from "vitest";
import { CAPTION_POSITION_Y, positionOfCaption } from "@/lib/style/caption-position";
import { CaptionPosition } from "@/lib/style/types";
import { FormatId, SAFE_AREA_DEFAULTS, createEmptyDoc, defaultCaptionStyle } from "@/lib/timeline";

describe("caption positions", () => {
  it("put lower where the editor puts captions, for every format", () => {
    for (const format of FormatId.options) {
      expect(CAPTION_POSITION_Y[format].lower, format).toBe(defaultCaptionStyle(createEmptyDoc(format, { width: 1080, height: 1080 })).y);
    }
  });

  it("run upper, middle, lower down the frame, all inside the format's safe area", () => {
    for (const format of FormatId.options) {
      const { upper, middle, lower } = CAPTION_POSITION_Y[format];
      const safe = SAFE_AREA_DEFAULTS[format];
      expect(upper, format).toBeGreaterThanOrEqual(safe.top);
      expect(upper < middle && middle < lower, format).toBe(true);
      expect(lower, format).toBeLessThanOrEqual(safe.top + safe.height);
    }
  });

  it("are the numbers the skills give agents", () => {
    expect(CAPTION_POSITION_Y.short_9x16).toEqual({ upper: 0.25, middle: 0.45, lower: 0.558 });
    for (const format of ["feed_4x5", "square_1x1", "long_16x9", "long_4k", "custom"] as const) {
      expect(CAPTION_POSITION_Y[format], format).toEqual({ upper: 0.2, middle: 0.5, lower: 0.788 });
    }
  });

  it("read each position's own y back as that position, in every format", () => {
    for (const format of FormatId.options) {
      for (const position of CaptionPosition.options) expect(positionOfCaption(format, CAPTION_POSITION_Y[format][position]), `${format} ${position}`).toBe(position);
    }
  });

  it("take a y to the nearest of the format's three, halfway to the lower one", () => {
    // 9:16: upper under 0.35, middle under 0.504, lower from there.
    expect([0, 0.34, 0.35, 0.5, 0.504, 0.6, 1].map((y) => positionOfCaption("short_9x16", y))).toEqual(["upper", "upper", "middle", "middle", "lower", "lower", "lower"]);
    // The others: upper under 0.35, middle under 0.644, lower from there.
    expect([0, 0.34, 0.35, 0.6, 0.644, 0.8, 1].map((y) => positionOfCaption("long_16x9", y))).toEqual(["upper", "upper", "middle", "middle", "lower", "lower", "lower"]);
  });
});
