import { describe, expect, it } from "vitest";
import { cropBox, platformView, platformViewsFor } from "@/lib/editor/platform-views";
import { FORMAT_PRESETS } from "@/lib/timeline";

const ids = (size: { width: number; height: number }) => platformViewsFor(size).map((v) => v.id);

describe("platform views", () => {
  it("vertical video gets every short-form app and the feed crops", () => {
    expect(ids(FORMAT_PRESETS.short_9x16)).toEqual([
      "instagram-reels",
      "instagram-feed",
      "instagram-grid",
      "youtube-shorts",
      "tiktok",
      "facebook-reels",
      "facebook-feed",
      "linkedin-feed",
    ]);
  });

  it("feed and square posts get the profile grid, landscape gets YouTube", () => {
    expect(ids(FORMAT_PRESETS.feed_4x5)).toEqual(["instagram-grid"]);
    expect(ids(FORMAT_PRESETS.square_1x1)).toEqual(["instagram-grid"]);
    expect(ids(FORMAT_PRESETS.long_16x9)).toEqual(["youtube-video"]);
    expect(ids(FORMAT_PRESETS.long_4k)).toEqual(["youtube-video"]);
  });

  it("a view the shape does not offer is none", () => {
    expect(platformView(FORMAT_PRESETS.long_16x9, "tiktok")).toBeNull();
    expect(platformView(FORMAT_PRESETS.short_9x16, null)).toBeNull();
    expect(platformView(FORMAT_PRESETS.short_9x16, "tiktok")?.label).toBe("TikTok");
  });

  it("every covered area and mark stays inside the frame", () => {
    for (const size of Object.values(FORMAT_PRESETS)) {
      for (const view of platformViewsFor(size)) {
        for (const b of [...view.covered, ...view.marks]) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(1.0001);
          expect(b.y + b.h).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });

  it("YouTube Shorts covers Google's published margins", () => {
    const shorts = platformView(FORMAT_PRESETS.short_9x16, "youtube-shorts")!;
    const right = shorts.covered.find((b) => b.x > 0.5 && b.y > 0)!;
    expect(right.w).toBeCloseTo(0.178);
    expect(shorts.covered[0].h).toBeCloseTo(0.15);
    expect(shorts.covered[1].h).toBeCloseTo(0.35);
  });

  it("a crop is the centred box of its shape", () => {
    // 9:16 in a 4:5 feed: full width, the middle 70% of the height.
    const feed = cropBox(9 / 16, 4 / 5);
    expect(feed.w).toBe(1);
    expect(feed.h).toBeCloseTo(0.703, 3);
    expect(feed.y).toBeCloseTo((1 - feed.h) / 2);
    // Square on the 3:4 grid: full height, three quarters of the width.
    expect(cropBox(1, 3 / 4)).toEqual({ x: 0.125, y: 0, w: 0.75, h: 1 });
  });
});
