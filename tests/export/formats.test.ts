import { describe, expect, it } from "vitest";
import { exportFileName, exportNotes, maxBytes } from "@/lib/export/facts";
import { planExportMedia } from "@/lib/export/media-sources";
import { EXPORT_FORMATS, encoderConfig, formatFacts, shownFps, soundBitrate, soundCodec, videoSettings, vp9Codec } from "@/lib/export/presets";
import { memoryTarget } from "@/lib/export/sinks";
import { sampleDoc } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";

const HD = { width: 1920, height: 1080 };

describe("the kinds of file", () => {
  it("are an MP4, a WebM, a GIF and sound alone, each with its ending and what it holds", () => {
    expect(EXPORT_FORMATS.map((f) => [f.id, f.extension, f.mime, f.picture, f.sound, f.encodes])).toEqual([
      ["mp4", "mp4", "video/mp4", true, true, true],
      ["webm", "webm", "video/webm", true, true, true],
      ["gif", "gif", "image/gif", true, false, false],
      ["m4a", "m4a", "audio/mp4", false, true, false],
      ["wav", "wav", "audio/wav", false, true, false],
    ]);
    expect(formatFacts("webm").says).toBe("WebM, VP9 video");
    expect(EXPORT_FORMATS.map((f) => soundCodec(f.id))).toEqual(["aac", "opus", null, "aac", "pcm"]);
  });
});

describe("a WebM's picture", () => {
  it("is VP9 at the lowest level that holds the size at the frame rate", () => {
    expect(vp9Codec({ width: 1280, height: 720 }, 30)).toBe("vp09.00.31.08");
    expect(vp9Codec(HD, 30)).toBe("vp09.00.40.08");
    expect(vp9Codec(HD, 60)).toBe("vp09.00.41.08");
    expect(vp9Codec({ width: 3840, height: 2160 }, 30)).toBe("vp09.00.50.08");
    expect(vp9Codec({ width: 3840, height: 2160 }, 60)).toBe("vp09.00.51.08");
    expect(vp9Codec({ width: 8000, height: 8000 }, 30)).toBeNull();
  });
  it("gets the bits an MP4 of that size and quality gets, and is asked of the encoder without H.264's own setting", () => {
    expect(videoSettings(HD, 30, "standard", "webm")).toEqual({ ...HD, fps: 30, codec: "vp09.00.40.08", bitrate: 8_000_000 });
    expect(videoSettings(HD, 30, "small", "webm")!.bitrate).toBe(4_000_000);
    expect(videoSettings({ width: 8000, height: 8000 }, 30, "standard", "webm")).toBeNull();
    const config = encoderConfig(videoSettings(HD, 30, "standard", "webm")!, "no-preference");
    expect(config).toEqual({ codec: "vp09.00.40.08", width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30, hardwareAcceleration: "no-preference", latencyMode: "quality" });
    expect(encoderConfig(videoSettings(HD, 30)!, "no-preference").avc).toEqual({ format: "avc" });
  });
});

describe("a GIF and a file of sound alone", () => {
  it("a GIF is small and slow, whatever quality is picked", () => {
    expect(videoSettings(HD, 30, "high", "gif")).toMatchObject({ width: 480, height: 270, fps: 30, codec: "gif" });
    expect([shownFps("gif", 30), shownFps("gif", 60), shownFps("gif", 25), shownFps("mp4", 30)]).toEqual([15, 15, 12.5, 30]);
  });
  it("sound alone keeps the project's timing and has no picture bits", () => {
    expect(videoSettings(HD, 24, "high", "wav")).toEqual({ ...HD, fps: 24, codec: "none", bitrate: 0 });
    expect(videoSettings(HD, 24, "small", "m4a")).toEqual({ ...HD, fps: 24, codec: "none", bitrate: 0 });
  });
  it("sound is 128 kbit/s where it is encoded, 1,536 as a WAV, and none in a GIF", () => {
    expect((["mp4", "webm", "m4a", "wav", "gif"] as const).map(soundBitrate)).toEqual([128_000, 128_000, 128_000, 1_536_000, 0]);
  });
});

describe("the largest a file gets", () => {
  it("counts the picture and the sound its format has, for its length", () => {
    const seconds = 10;
    const frames = seconds * 30;
    const of = (format: "mp4" | "webm" | "gif" | "m4a" | "wav") => maxBytes(videoSettings(HD, 30, "standard", format)!, frames, format);
    expect(of("mp4")).toBe(((8_000_000 + 128_000) * seconds) / 8);
    expect(of("mp4")).toBe(maxBytes(videoSettings(HD, 30)!, frames)); // an MP4 when no format is named
    expect(of("webm")).toBe(of("mp4"));
    expect(of("m4a")).toBe((128_000 * seconds) / 8);
    expect(of("wav")).toBe(48_000 * 2 * 2 * seconds);
    // A byte a pixel for each of its fifteen frames a second.
    expect(of("gif")).toBe(480 * 270 * 15 * seconds);
  });
});

describe("the file's name", () => {
  it("ends as its format does, and says its size only where there is one to pick", () => {
    expect(exportFileName("Qual recap", "draft")).toBe("Qual recap (draft).mp4");
    expect(exportFileName("Qual recap", "draft", "webm")).toBe("Qual recap (draft).webm");
    expect(exportFileName("Qual recap", "project", "webm")).toBe("Qual recap.webm");
    expect(exportFileName("Qual recap", "draft", "gif")).toBe("Qual recap.gif");
    expect(exportFileName("Qual recap", "1080p", "m4a")).toBe("Qual recap.m4a");
    expect(exportFileName("Qual recap", "project", "wav")).toBe("Qual recap.wav");
  });
});

describe("what the person is told before", () => {
  const assets = { a: assetView() };
  const plan = (sound: boolean) => planExportMedia(sampleDoc(), { assets, loaded: true }, sound);
  const COPIES = "Video clips export from their 720p preview copies.";
  const NO_TRACK = /can't add sound to the file/;
  it("a GIF says nothing of sound, and at its size nothing of the smaller copies", () => {
    expect(exportNotes(plan(false), { width: 270, height: 480 }, false, sampleDoc(), "gif")).toEqual([]);
    expect(exportNotes(plan(false), { width: 1080, height: 1920 }, false, sampleDoc(), "mp4")).toEqual([COPIES, expect.stringMatching(NO_TRACK)]);
  });
  it("sound alone says nothing of the pictures, and counts a clip with no media as silent", () => {
    expect(exportNotes(plan(true), { width: 1080, height: 1920 }, true, sampleDoc(), "wav")).toEqual([]);
    const gone = planExportMedia(sampleDoc(), { assets: { a: assetView({ removed: true }) }, loaded: true }, true);
    expect(exportNotes(gone, { width: 1080, height: 1920 }, true, sampleDoc(), "m4a")).toEqual(["2 sound clips have no media, so they export silent, as in the preview."]);
    // As a video, the same two clips are counted once, for their pictures.
    expect(exportNotes(gone, { width: 720, height: 1280 }, true, sampleDoc(), "mp4")).toEqual(["2 clips have no media to show, so they export as the placeholders in the preview."]);
  });
});

describe("a file held in memory", () => {
  it("is handed over as the kind of file it is", async () => {
    const saved: Blob[] = [];
    for (const mime of [undefined, "image/gif"]) {
      const sink = await memoryTarget((blob) => saved.push(blob), 100, mime).open();
      await sink.write(0, new Uint8Array([1, 2, 3]));
      await sink.close();
    }
    expect(saved.map((b) => [b.type, b.size])).toEqual([["video/mp4", 3], ["image/gif", 3]]);
  });
});
