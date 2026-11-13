import { describe, expect, it } from "vitest";
import {
  exportFileName, exportNotes, formatBytes, frameFileName, maxBytes, sameDoc, secondsLeft, timeLeftLabel, waitingReason,
} from "@/lib/export/facts";
import { planExportMedia } from "@/lib/export/media-sources";
import { videoSettings, type EncoderConfig } from "@/lib/export/presets";
import { checkSupport, type SupportProbe } from "@/lib/export/support";
import type { AssetView } from "@/lib/media/types";
import { createEmptyDoc } from "@/lib/timeline";
import { sampleDoc, text, video } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";

const plan = (assets: AssetView[] = [assetView()], loaded = true, doc = sampleDoc()) =>
  planExportMedia(doc, { assets: Object.fromEntries(assets.map((a) => [a.id, a])), loaded });
const SOUND = "Sound isn't exported yet. The file's sound track is silent.";
const COPIES = "Video clips export from their 720p preview copies.";
const FULL = { width: 1080, height: 1920 };
const DRAFT = { width: 720, height: 1280 };

describe("the file's facts", () => {
  it("estimates the largest size from the bitrates and the length", () => {
    expect(maxBytes(videoSettings({ width: 1080, height: 1920 }, 30)!, 120)).toBe(4_064_000);
    expect(maxBytes(videoSettings({ width: 720, height: 1280 }, 30)!, 120)).toBe(1_314_000);
    expect(maxBytes(videoSettings({ width: 1080, height: 1920 }, 30)!, 1)).toBe(33_867);
  });

  it("writes sizes the way file managers do", () => {
    expect([0, 1, 850_000, 999_001].map(formatBytes)).toEqual(["1 KB", "1 KB", "850 KB", "1000 KB"]);
    expect([1_234_567, 4_064_000, 9_949_999].map(formatBytes)).toEqual(["1.2 MB", "4.1 MB", "9.9 MB"]);
    expect([12_400_000, 536_870_912].map(formatBytes)).toEqual(["12 MB", "537 MB"]);
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
    expect(formatBytes(1_000_000)).toBe("1.0 MB"); // a million bytes is a megabyte, not 1024 × 1024
  });

  it("suggests a file name every file system accepts", () => {
    expect(exportFileName("Qual recap", "project")).toBe("Qual recap.mp4");
    expect(exportFileName("Qual recap", "draft")).toBe("Qual recap (draft).mp4");
    expect(exportFileName("4K film", "1080p")).toBe("4K film (1080p).mp4");
    expect(exportFileName('a/b:c*?"<>|\\d\u0007e', "project")).toBe("a b c d e.mp4");
    expect(exportFileName("Final.", "project")).toBe("Final.mp4");
    expect(exportFileName("  ...  ", "project")).toBe("Untitled.mp4");
    expect(exportFileName("x".repeat(200), "project")).toBe(`${"x".repeat(80)}.mp4`);
    expect(frameFileName("Qual recap", 45)).toBe("Qual recap frame 000045.png");
    expect(frameFileName("a/b", 0)).toBe("a b frame 000000.png");
  });

  it("says how long is left once it can tell", () => {
    expect(secondsLeft(0, 120, 5_000)).toBeNull();
    expect(secondsLeft(30, 120, 500)).toBeNull();
    expect(secondsLeft(30, 120, 3_000)).toBe(9);
    expect(secondsLeft(120, 120, 3_000)).toBe(0);
    expect([null, 3, 9, 55, 56, 61, 600].map(timeLeftLabel)).toEqual([
      "", "A few seconds left", "About 10 seconds left", "About 55 seconds left", "About 1 minute left", "About 2 minutes left", "About 10 minutes left",
    ]);
  });

  it("tells whether two documents hold the same content", () => {
    const a = sampleDoc();
    const backward = (_key: string, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value;
    expect(sameDoc(a, sampleDoc())).toBe(true);
    expect(sameDoc(a, JSON.parse(JSON.stringify(a, backward)))).toBe(true); // the same content with every key in another order
    const moved = sampleDoc();
    moved.tracks[1].clips[0].start = 1;
    expect(sameDoc(a, moved)).toBe(false);
  });

  it("counts a key left undefined as absent, as the stored project does, and still tells a missing value apart", () => {
    const a = sampleDoc();
    const cleared = sampleDoc();
    Object.assign(cleared.tracks[0].clips[0], { crop: undefined });
    expect(sameDoc(a, cleared)).toBe(true);
    const extra = sampleDoc();
    extra.tracks[1].clips.pop();
    expect(sameDoc(a, extra)).toBe(false);
    expect(sameDoc(extra, a)).toBe(false);
    const cropped = sampleDoc();
    Object.assign(cropped.tracks[0].clips[0], { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } });
    expect(sameDoc(a, cropped)).toBe(false); // a key only the second has
    expect(sameDoc(cropped, a)).toBe(false);
  });
});

describe("what the dialog says about the media", () => {
  it("says what the file will hold: placeholders, the 720p copies above 720, and a silent sound track", () => {
    expect(exportNotes(plan(), FULL, true)).toEqual([COPIES, SOUND]);
    expect(exportNotes(plan(), DRAFT, true)).toEqual([SOUND]);
    expect(exportNotes(plan([assetView({ removed: true })]), FULL, true)).toEqual([
      "2 clips have no media to show, so they export as the placeholders in the preview.", SOUND,
    ]);
    const mixed = sampleDoc();
    mixed.tracks[0].clips = [video("c1", 0, 30, { assetId: "gone" }), video("c2", 30, 30, { assetId: "small" })];
    const small = assetView({ id: "small", previewStatus: "failed", previewFileId: null });
    // c2 plays its small original, so there is no 720p line
    expect(exportNotes(plan([small], true, mixed), FULL, true)).toEqual(["1 clip has no media to show, so it exports as the placeholder in the preview.", SOUND]);
    const textOnly = createEmptyDoc("short_9x16");
    textOnly.tracks[1].clips = [text("x1", 0, 30)];
    expect(exportNotes(plan([], true, textOnly), FULL, true)).toEqual([SOUND]);
  });

  it("says the file will have no sound track where this browser cannot encode AAC", () => {
    expect(exportNotes(plan(), DRAFT, false)).toEqual(["Sound isn't exported yet. This file will have no sound track."]);
  });

  it("says why it cannot export yet", () => {
    expect(waitingReason(plan())).toBeNull();
    expect(waitingReason(plan([assetView({ status: "uploading" })]))).toBe("2 clips use media that is still uploading or being prepared. Export once it's ready.");
    const one = sampleDoc();
    one.tracks[0].clips = [video("c1", 0, 30)];
    expect(waitingReason(plan([assetView({ previewStatus: "pending" })], true, one))).toBe("1 clip uses media that is still uploading or being prepared. Export once it's ready.");
    expect(waitingReason(plan([], false))).toBe("Checking the media library…");
    expect(waitingReason(plan([assetView({ removed: true })]))).toBeNull(); // a placeholder never waits
  });
});

describe("what this browser and computer can export", () => {
  const probe = (over: Partial<SupportProbe> = {}): SupportProbe =>
    ({ hasWorkers: true, hasOffscreenCanvas: true, hasVideoEncoder: true, canEncode: async () => true, canEncodeAudio: async () => true, ...over });
  const tall = { width: 1080, height: 1920, fps: 30 };
  const uhd = { width: 3840, height: 2160, fps: 30 };

  it("says yes to every size an able browser can encode", async () => {
    expect(await checkSupport(probe(), tall)).toEqual({ browser: true, sizes: { project: true, draft: true }, audio: true });
    expect(await checkSupport(probe(), uhd)).toEqual({ browser: true, sizes: { project: true, "1080p": true, draft: true }, audio: true });
  });

  it("says whether the file can carry a sound track, without making AAC a condition", async () => {
    expect(await checkSupport(probe({ canEncodeAudio: async () => false }), tall)).toEqual({ browser: true, sizes: { project: true, draft: true }, audio: false });
    expect((await checkSupport(probe({ canEncodeAudio: async () => { throw new Error("x"); } }), tall)).audio).toBe(false);
  });

  it("tries the software encoder before giving up on a size, and marks a size this computer cannot make", async () => {
    const asked: string[] = [];
    const canEncode = async (config: EncoderConfig) => {
      asked.push(`${config.width} ${config.hardwareAcceleration}`);
      return config.width <= 1920 && config.hardwareAcceleration === "prefer-software";
    };
    expect(await checkSupport(probe({ canEncode }), uhd)).toEqual({ browser: true, sizes: { project: false, "1080p": true, draft: true }, audio: true });
    expect(asked).toEqual(["3840 no-preference", "3840 prefer-software", "1920 no-preference", "1920 prefer-software", "1280 no-preference", "1280 prefer-software"]);
  });

  it("asks no further once the browser's choice of encoder says yes", async () => {
    const asked: string[] = [];
    const canEncode = async (config: EncoderConfig) => (asked.push(config.hardwareAcceleration), true);
    await checkSupport(probe({ canEncode }), tall);
    expect(asked).toEqual(["no-preference", "no-preference"]);
  });

  it("calls a browser unsupported when a feature is missing or nothing can be encoded", async () => {
    const no = { browser: false, sizes: {}, audio: false };
    expect(await checkSupport(probe({ hasWorkers: false }), tall)).toEqual(no);
    expect(await checkSupport(probe({ hasOffscreenCanvas: false }), tall)).toEqual(no);
    expect(await checkSupport(probe({ hasVideoEncoder: false }), tall)).toEqual(no);
    expect(await checkSupport(probe({ canEncode: async () => false }), tall)).toEqual(no);
    expect(await checkSupport(probe({ canEncode: async () => { throw new Error("bad config"); } }), tall)).toEqual(no);
  });
});
