import { describe, expect, it } from "vitest";
import {
  ACCELERATION_ORDER, AUDIO, AVC_LEVELS, EXPORT_PRESETS, KEYFRAME_SECONDS,
  avcCodec, avcLevel, encoderConfig, exportOptions, exportSize, videoBitrate, videoSettings,
} from "@/lib/export/presets";
import { createEmptyDoc, type FormatId } from "@/lib/timeline";

const PRESETS: FormatId[] = ["short_9x16", "feed_4x5", "square_1x1", "long_16x9", "long_4k"];
// Custom sizes the dashboard allows: thin, wide, a page, 4K area, the most macroblocks of any allowed size.
const CUSTOM = [[16, 4096], [4096, 16], [2048, 1024], [816, 1056], [4096, 2024], [2114, 3922]] as const;
const ALL = [...PRESETS.map((format) => createEmptyDoc(format)), ...CUSTOM.map(([width, height]) => ({ width, height }))];
const rows = (size: { width: number; height: number }) => exportOptions(size).map((o) => `${o.id} ${o.size.width}x${o.size.height} ${o.label}`);

describe("export sizes", () => {
  it("offers the project's own size first, then 1080p and Draft where each is a real downscale", () => {
    expect(rows(createEmptyDoc("short_9x16"))).toEqual(["project 1080x1920 Same as project (1080 × 1920)", "draft 720x1280 Draft (720 × 1280)"]);
    expect(rows(createEmptyDoc("feed_4x5"))).toEqual(["project 1080x1350 Same as project (1080 × 1350)", "draft 720x900 Draft (720 × 900)"]);
    expect(rows(createEmptyDoc("square_1x1"))).toEqual(["project 1080x1080 Same as project (1080 × 1080)", "draft 720x720 Draft (720 × 720)"]);
    expect(rows(createEmptyDoc("long_16x9"))).toEqual(["project 1920x1080 Same as project (1920 × 1080)", "draft 1280x720 Draft (1280 × 720)"]);
    expect(rows(createEmptyDoc("long_4k"))).toEqual([
      "project 3840x2160 Same as project (3840 × 2160)", "1080p 1920x1080 1080p (1920 × 1080)", "draft 1280x720 Draft (1280 × 720)",
    ]);
    expect(EXPORT_PRESETS.map((p) => [p.id, p.label, p.box])).toEqual([
      ["project", "Same as project", null], ["1080p", "1080p", { short: 1080, long: 1920 }], ["draft", "Draft", { short: 720, long: 1280 }],
    ]);
  });

  it("fits a custom size inside each box, and never offers a side under 16", () => {
    expect(rows({ width: 16, height: 4096 })).toEqual(["project 16x4096 Same as project (16 × 4096)"]);
    expect(rows({ width: 4096, height: 16 })).toEqual(["project 4096x16 Same as project (4096 × 16)"]);
    expect(rows({ width: 2048, height: 1024 })).toEqual([
      "project 2048x1024 Same as project (2048 × 1024)", "1080p 1920x960 1080p (1920 × 960)", "draft 1280x640 Draft (1280 × 640)",
    ]);
    expect(rows({ width: 816, height: 1056 })).toEqual(["project 816x1056 Same as project (816 × 1056)", "draft 720x932 Draft (720 × 932)"]);
    expect(rows({ width: 4096, height: 2024 })).toEqual([
      "project 4096x2024 Same as project (4096 × 2024)", "1080p 1920x948 1080p (1920 × 948)", "draft 1280x632 Draft (1280 × 632)",
    ]);
    expect(exportSize({ width: 640, height: 360 }, "draft")).toBeNull();
    expect(exportSize({ width: 1080, height: 1920 }, "1080p")).toBeNull();
  });

  it("keeps both sides even", () => {
    expect(exportSize({ width: 1081, height: 1919 }, "project")).toEqual({ width: 1082, height: 1920 });
    for (const size of ALL) {
      for (const o of exportOptions(size)) expect([o.size.width % 2, o.size.height % 2], o.label).toEqual([0, 0]);
    }
  });
});

describe("the H.264 settings", () => {
  it("uses High profile at the lowest level that fits the size, each side and the frame rate", () => {
    expect(avcCodec({ width: 1080, height: 1920 }, 30)).toBe("avc1.640028");
    expect(avcCodec({ width: 1080, height: 1350 }, 30)).toBe("avc1.640028");
    expect(avcCodec({ width: 1080, height: 1080 }, 30)).toBe("avc1.640028");
    expect(avcCodec({ width: 1920, height: 1080 }, 30)).toBe("avc1.640028");
    expect(avcCodec({ width: 3840, height: 2160 }, 30)).toBe("avc1.640033");
    expect(avcCodec({ width: 720, height: 1280 }, 30)).toBe("avc1.64001f");
    expect(avcCodec({ width: 720, height: 900 }, 30)).toBe("avc1.64001f");
    expect(avcCodec({ width: 1280, height: 720 }, 30)).toBe("avc1.64001f");
    expect(avcCodec({ width: 1920, height: 1080 }, 60)).toBe("avc1.64002a");
    expect(avcCodec({ width: 3840, height: 2160 }, 60)).toBe("avc1.640034");
    expect(avcCodec({ width: 7680, height: 4320 }, 30)).toBeNull();
    // a side too long for level 3.1: 256 macroblocks, over its 169
    expect(avcCodec({ width: 16, height: 4096 }, 30)).toBe("avc1.640028");
    expect(avcCodec({ width: 4096, height: 16 }, 30)).toBe("avc1.640028");
    expect(avcCodec({ width: 816, height: 1056 }, 30)).toBe("avc1.64001f");
    expect(avcCodec({ width: 4096, height: 2024 }, 30)).toBe("avc1.640033");
    expect(avcCodec({ width: 2114, height: 3922 }, 30)).toBe("avc1.640033");
    expect(AVC_LEVELS.map((l) => [l.level, l.maxSideMbs])).toEqual([["3.1", 169], ["4.0", 256], ["4.2", 263], ["5.1", 543], ["5.2", 543]]);
    for (const l of AVC_LEVELS) expect(l.maxSideMbs).toBe(Math.floor(Math.sqrt(8 * l.maxFrameMbs)));
  });

  it("checks the macroblocks in one frame on their own, which a low frame rate would otherwise slip past", () => {
    // At 10 fps both sizes are within level 3.1's (and 4.2's) macroblocks per second; only the frame limit lifts them.
    expect(avcCodec({ width: 1920, height: 1080 }, 10)).toBe("avc1.640028");
    expect(avcCodec({ width: 3840, height: 2160 }, 10)).toBe("avc1.640033");
  });

  it("sets the bitrate by output size, and holds it under the level's cap", () => {
    expect(videoBitrate({ width: 720, height: 1280 })).toBe(2_500_000);
    expect(videoBitrate({ width: 1280, height: 720 })).toBe(2_500_000);
    expect(videoBitrate({ width: 1080, height: 1080 })).toBe(8_000_000);
    expect(videoBitrate({ width: 1080, height: 1920 })).toBe(8_000_000);
    expect(videoBitrate({ width: 1920, height: 1080 })).toBe(8_000_000);
    expect(videoBitrate({ width: 3840, height: 2160 })).toBe(40_000_000);
    expect(videoBitrate({ width: 2048, height: 1024 })).toBe(40_000_000);
    expect(videoSettings({ width: 2048, height: 1024 }, 30)).toEqual({ width: 2048, height: 1024, fps: 30, codec: "avc1.640028", bitrate: 25_000_000 });
    expect(videoSettings({ width: 4096, height: 2024 }, 30)).toEqual({ width: 4096, height: 2024, fps: 30, codec: "avc1.640033", bitrate: 40_000_000 });
  });

  it("keeps every offered size inside its level's limits", () => {
    for (const size of ALL) {
      const sizes = exportOptions(size).map((o) => `${o.size.width}x${o.size.height}`);
      expect(new Set(sizes).size, sizes.join(" ")).toBe(sizes.length); // no size is offered twice
      for (const option of exportOptions(size)) {
        const video = videoSettings(option.size, 30)!;
        const level = avcLevel(option.size, 30)!;
        expect(video.codec, option.label).toBe(`avc1.6400${level.hex}`);
        const w = Math.ceil(video.width / 16);
        const h = Math.ceil(video.height / 16);
        expect(w * h, option.label).toBeLessThanOrEqual(level.maxFrameMbs);
        expect(w * h * 30, option.label).toBeLessThanOrEqual(level.maxMbsPerSecond);
        expect(Math.max(w, h), option.label).toBeLessThanOrEqual(level.maxSideMbs);
        expect(video.bitrate, option.label).toBeLessThanOrEqual(level.maxBitrate);
      }
    }
  });

  it("builds one encoder configuration for the page and the worker to check", () => {
    const video = videoSettings({ width: 1080, height: 1920 }, 30);
    expect(video).toEqual({ width: 1080, height: 1920, fps: 30, codec: "avc1.640028", bitrate: 8_000_000 });
    expect(encoderConfig(video!, "prefer-software")).toEqual({
      codec: "avc1.640028", width: 1080, height: 1920, bitrate: 8_000_000, framerate: 30,
      hardwareAcceleration: "prefer-software", latencyMode: "quality", avc: { format: "avc" },
    });
    expect(videoSettings({ width: 7680, height: 4320 }, 30)).toBeNull();
    expect(ACCELERATION_ORDER).toEqual(["no-preference", "prefer-software"]);
    expect(AUDIO).toEqual({ codec: "mp4a.40.2", sampleRate: 48_000, channels: 2, bitrate: 128_000 });
    expect(KEYFRAME_SECONDS).toBe(2);
  });
});
