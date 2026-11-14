import { expect, it } from "vitest";
import { sourceSeconds } from "@/lib/render/source-time";
import type { MediaClip } from "@/lib/timeline";
import { video } from "../editor/fixtures";

const clip = (extra: Record<string, unknown> = {}) => video("c", 30, 90, extra) as MediaClip;

it("is the clip's in point plus the frames since its start, times its speed, in seconds", () => {
  expect(sourceSeconds(clip({ in: 60, speed: 2 }), 30, 30)).toBe(2);
  expect(sourceSeconds(clip({ in: 60, speed: 2 }), 45, 30)).toBe(3); // (60 + 15 × 2) / 30
  expect(sourceSeconds(clip(), 59, 30)).toBe(29 / 30);
  expect(sourceSeconds(clip({ in: 24 }), 30, 24)).toBe(1);
  expect(sourceSeconds(clip({ type: "image", in: 60 }), 40, 30)).toBe(0);
});
