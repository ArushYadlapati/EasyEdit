import { describe, expect, it } from "vitest";
import { runPipeline, type PipelineIO, type PipelineOutput } from "@/lib/export/pipeline";
import { videoSettings } from "@/lib/export/presets";
import type { ExportJob } from "@/lib/export/protocol";
import { createEmptyDoc } from "@/lib/timeline";
import { text, video } from "../editor/fixtures";
import { NO_MEDIA, fakeMediaIO, file, tick, type FakeMediaOptions } from "./fakes";

const FACE = { family: "Geist", source: 'url("https://app.test/a.woff2")', descriptors: {}, required: true };
const LOCAL = { family: "Geist Fallback", source: "local(Arial)", descriptors: {}, required: false };
const PROBE = { font: '700 100px "Geist"', text: "Hamburgefonstiv", width: 750 };

function job(frames: number, over: Partial<ExportJob> = {}): ExportJob {
  const doc = createEmptyDoc("short_9x16");
  if (frames > 0) doc.tracks[1].clips = [text("a", 0, frames)];
  return {
    doc, video: videoSettings({ width: 1080, height: 1920 }, 30)!, acceleration: "no-preference",
    fonts: { families: { Geist: '"Geist"' }, faces: [FACE, LOCAL], probes: [PROBE] }, media: NO_MEDIA, ...over,
  };
}

function setup(over: Partial<PipelineIO> = {}, outOver: Partial<PipelineOutput> = {}, media: FakeMediaOptions = {}) {
  const log: string[] = [];
  const times: [number, number, number][] = [];
  const out: PipelineOutput = {
    draw: (frame) => { log.push(`draw ${frame}`); },
    addFrame: async (frame, seconds, duration, keyFrame) => { times.push([frame, seconds, duration]); log.push(`frame ${frame}${keyFrame ? " key" : ""}`); },
    addSilence: async (startSample, sampleCount) => { log.push(`silence ${startSample}+${sampleCount}`); },
    finish: async () => { log.push("finish"); return 4_321; },
    cancel: async () => { log.push("cancel"); },
    ...outOver,
  };
  const io: PipelineIO = {
    supported: () => true,
    media: fakeMediaIO({ ...media, log }),
    loadFace: async (spec) => { log.push(`face ${spec.family}`); return true; },
    measure: (_font, t) => t.length * 50,
    canEncode: async (_video, acceleration) => { log.push(`can ${acceleration}`); return true; },
    canEncodeAudio: async () => true,
    open: async (options) => { log.push(`open ${options.acceleration} audio=${options.audio}`); return out; },
    ...over,
  };
  const reports: [number, number][] = [];
  let clock = -60;
  const control = { onProgress: (done: number, total: number) => { reports.push([done, total]); }, now: () => (clock += 60) }; // 60 ms per frame
  return { io, log, times, reports, control };
}

describe("an ordinary export", () => {
  it("loads and checks the fonts, opens the encoder, writes sound and frames in order, and finishes", async () => {
    const { io, log, times, reports, control } = setup();
    expect(await runPipeline(job(4), io, control)).toEqual({ type: "done", bytes: 4_321, hasAudio: true });
    expect(log).toEqual([
      "face Geist", "face Geist Fallback", "can no-preference", "open no-preference audio=true",
      "silence 0+6400", "draw 0", "frame 0 key", "draw 1", "frame 1", "draw 2", "frame 2", "draw 3", "frame 3", "finish",
    ]);
    expect(times).toEqual([[0, 0, 1 / 30], [1, 1 / 30, 1 / 30], [2, 2 / 30, 1 / 30], [3, 3 / 30, 1 / 30]]);
    expect(reports).toEqual([[1, 4], [3, 4], [4, 4]]); // at once, then at most every 100 ms, and always the last frame
  });

  it("asks for a keyframe every two seconds, and writes each second's sound just before its first frame", async () => {
    const { io, log, control } = setup();
    await runPipeline(job(61), io, control);
    expect(log.filter((l) => l.endsWith(" key"))).toEqual(["frame 0 key", "frame 60 key"]);
    expect(log.slice(log.indexOf("frame 29") + 1, log.indexOf("frame 30") + 1)).toEqual(["silence 48000+48000", "draw 30", "frame 30"]);
    expect(log.filter((l) => l.startsWith("silence"))).toEqual(["silence 0+48000", "silence 48000+48000", "silence 96000+1600"]);
  });

  it("never draws the next frame before the encoder has taken the last one", async () => {
    const seen: string[] = [];
    let release = () => {};
    const { io, control } = setup({}, {
      draw: (frame) => { seen.push(`draw ${frame}`); },
      addFrame: (frame) => {
        seen.push(`frame ${frame}`);
        return frame === 0 ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
      },
    });
    const running = runPipeline(job(2), io, control);
    await tick();
    expect(seen).toEqual(["draw 0", "frame 0"]);
    release();
    expect(await running).toMatchObject({ type: "done" });
    expect(seen).toEqual(["draw 0", "frame 0", "draw 1", "frame 1"]);
  });

  it("passes the try's encoder hint through", async () => {
    const { io, log, control } = setup();
    await runPipeline(job(1, { acceleration: "prefer-software" }), io, control);
    expect(log).toContain("can prefer-software");
    expect(log).toContain("open prefer-software audio=true");
  });

  it("writes no sound track when the browser cannot encode AAC", async () => {
    const { io, log, control } = setup({ canEncodeAudio: async () => false });
    expect(await runPipeline(job(4), io, control)).toEqual({ type: "done", bytes: 4_321, hasAudio: false });
    expect(log).toContain("open no-preference audio=false");
    expect(log.filter((l) => l.startsWith("silence"))).toEqual([]);
  });

  it.each([
    ["a font face that throws", { loadFace: async () => { throw new Error("net"); } }, { type: "failed", code: "font", detail: "Geist" }],
    ["a measure that throws", { measure: () => { throw new Error("no ctx"); } }, { type: "failed", code: "unknown", detail: "no ctx" }],
    ["an AAC check that throws", { canEncodeAudio: async () => { throw new Error("x"); } }, { type: "done", bytes: 4_321, hasAudio: false }],
  ] as const)("never rejects: %s", async (_name, over, result) => {
    const { io, control } = setup(over as Partial<PipelineIO>);
    await expect(runPipeline(job(4), io, control)).resolves.toEqual(result);
  });
});

describe("what stops an export before the first frame", () => {
  it.each([
    ["a browser without the features", { supported: () => false }, "unsupported"],
    ["a font file that does not load", { loadFace: async (spec: { required: boolean }) => !spec.required }, "font"],
    ["a font that measures differently", { measure: (_font: string, t: string) => t.length * 51 }, "font-mismatch"],
    ["a size this computer cannot encode", { canEncode: async () => false }, "size"],
    ["an encoder that does not start", { open: async () => { throw new Error("boom"); } }, "encoder"],
  ] as const)("%s", async (_name, over, code) => {
    const { io, log, control } = setup(over as Partial<PipelineIO>);
    expect(await runPipeline(job(4), io, control)).toMatchObject({ type: "failed", code });
    expect(log.filter((l) => l.startsWith("draw") || l.startsWith("frame") || l === "finish")).toEqual([]);
  });

  it("names the font, carries on without a face that only points at an installed font, and refuses an empty project", async () => {
    const failing = setup({ loadFace: async (spec) => !spec.required });
    expect(await runPipeline(job(4), failing.io, failing.control)).toEqual({ type: "failed", code: "font", detail: "Geist" });
    const optional = setup({ loadFace: async (spec) => spec.required });
    expect(await runPipeline(job(4), optional.io, optional.control)).toMatchObject({ type: "done" });
    const off = setup({ measure: (_font, t) => t.length * 51 });
    expect(await runPipeline(job(4), off.io, off.control)).toEqual({ type: "failed", code: "font-mismatch", detail: '700 100px "Geist"' });
    const empty = setup();
    expect(await runPipeline(job(0), empty.io, empty.control)).toEqual({ type: "failed", code: "empty", detail: "" });
    expect(empty.log).toEqual([]);
  });
});

describe("a failure in the middle", () => {
  it("releases the encoder and says what kind of failure it was", async () => {
    const encoder = setup({}, { addFrame: async (frame) => { if (frame === 2) throw new Error("encoder closed"); } });
    expect(await runPipeline(job(4), encoder.io, encoder.control)).toEqual({ type: "failed", code: "encoder", detail: "encoder closed" });
    await tick(); // the cleanup runs after the result
    expect(encoder.log.at(-1)).toBe("cancel");
    expect(encoder.log).not.toContain("finish");

    const drawing = setup({}, { draw: () => { throw new Error("bad clip"); } });
    expect(await runPipeline(job(4), drawing.io, drawing.control)).toEqual({ type: "failed", code: "unknown", detail: "bad clip" });
    await tick();
    expect(drawing.log.at(-1)).toBe("cancel");

    const closing = setup({}, { finish: async () => { throw new Error("disk"); }, cancel: async () => { throw new Error("already closed"); } });
    expect(await runPipeline(job(4), closing.io, closing.control)).toEqual({ type: "failed", code: "encoder", detail: "disk" });
  });

  it("gives its result even when the encoder never lets go", async () => {
    const stuck = setup({}, { addFrame: async () => { throw new Error("encoder closed"); }, cancel: () => new Promise<void>(() => {}) });
    expect(await runPipeline(job(4), stuck.io, stuck.control)).toEqual({ type: "failed", code: "encoder", detail: "encoder closed" });
  });
});

describe("media", () => {
  // c1 draws file prev-a on frames 0 and 1; c2's media was removed, so it draws its placeholder on frames 2 and 3.
  const withMedia = () => {
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 2), video("c2", 2, 2, { assetId: "r" })];
    return job(4, { doc, media: { files: { "prev-a": file("a.mp4") }, clips: { c1: { fileId: "prev-a" }, c2: { label: "Media removed" } } } });
  };

  it("checks every video file before the encoder opens, gives each frame its pictures, and releases them", async () => {
    const seen: string[] = [];
    const { io, log, control } = setup({}, { draw: (frame, sources) => { seen.push(`${frame}:${[...sources.keys()].join(",") || "-"}`); } });
    expect(await runPipeline(withMedia(), io, control)).toEqual({ type: "done", bytes: 4_321, hasAudio: true });
    expect(seen).toEqual(["0:c1", "1:c1", "2:-", "3:-"]);
    expect(log).toEqual([
      "face Geist", "face Geist Fallback", "can no-preference", "can-decode a.mp4", "open no-preference audio=true",
      "silence 0+6400", "open a.mp4 1920", "pictures a.mp4 from 0", "frame 0 key", "frame 1",
      "stop a.mp4 from 0", "dispose a.mp4", "frame 2", "frame 3", "finish",
    ]);
  });

  it("releases the decoders after the file is finished when a clip runs to the last frame", async () => {
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 2)];
    const { io, log, control } = setup();
    await runPipeline(job(2, { doc, media: { files: { "prev-a": file("a.mp4") }, clips: { c1: { fileId: "prev-a" } } } }), io, control);
    await tick();
    expect(log.slice(-3)).toEqual(["finish", "dispose a.mp4", "stop a.mp4 from 0"]);
  });

  it("stops before the encoder opens when a video cannot be decoded in this browser", async () => {
    const { io, log, control } = setup({}, {}, { decodable: () => false });
    expect(await runPipeline(withMedia(), io, control)).toEqual({ type: "failed", code: "decode", detail: "prev-a" });
    expect(log.filter((l) => l.startsWith("open") || l.startsWith("draw") || l.startsWith("frame"))).toEqual([]);
  });

  it("releases the encoder and the decoders, and says what kind of failure it was, when a decoder breaks", async () => {
    const { io, log, control } = setup({}, {}, { breaks: (_name, at) => at > 0 });
    expect(await runPipeline(withMedia(), io, control)).toEqual({ type: "failed", code: "decode", detail: "decoder closed" });
    await tick();
    expect(log.slice(-3)).toEqual(["cancel", "dispose a.mp4", "stop a.mp4 from 0"]);
    const unreadable = setup({}, {}, { unreadable: () => true });
    expect(await runPipeline(withMedia(), unreadable.io, unreadable.control)).toEqual({ type: "failed", code: "media", detail: "unreadable" });
    await tick();
    expect(unreadable.log.at(-1)).toBe("cancel");
  });

  it("ends the export when one decoder breaks while another never answers", async () => {
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 2)];
    doc.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [video("c3", 0, 2, { assetId: "b" })] });
    const media = { files: { "prev-a": file("a.mp4"), "prev-b": file("b.mp4") }, clips: { c1: { fileId: "prev-a" }, c3: { fileId: "prev-b" } } };
    // c1 is drawn first and never answers; c3 breaks
    const { io, control } = setup({}, {}, { hangs: (name) => name === "a.mp4", breaks: (name) => name === "b.mp4" });
    expect(await runPipeline(job(2, { doc, media }), io, control)).toEqual({ type: "failed", code: "decode", detail: "decoder closed" });
  });
});

describe("each step names its own failures", () => {
  it("calls a sound block the encoder refused an encoder failure", async () => {
    const { io, control } = setup({}, { addSilence: async () => { throw new Error("audio encoder closed"); } });
    expect(await runPipeline(job(4), io, control)).toEqual({ type: "failed", code: "encoder", detail: "audio encoder closed" });
  });

  it("calls a video file that cannot be checked a decode failure", async () => {
    const media = fakeMediaIO();
    const { io, log, control } = setup({ media: { ...media, canDecode: async () => { throw new Error("no demuxer"); } } });
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 2)];
    const withVideo = job(2, { doc, media: { files: { "prev-a": file("a.mp4") }, clips: { c1: { fileId: "prev-a" } } } });
    expect(await runPipeline(withVideo, io, control)).toEqual({ type: "failed", code: "decode", detail: "no demuxer" });
    expect(log.filter((l) => l.startsWith("open"))).toEqual([]);
  });

  it("calls a file that fails to let go between frames a decode failure", async () => {
    const media = fakeMediaIO();
    const brittle = { ...media, openVideo: async (blob: Blob, maxSide: number) => ({ ...(await media.openVideo(blob, maxSide)), dispose: () => { throw new Error("dispose failed"); } }) };
    const { io, control } = setup({ media: brittle });
    const doc = createEmptyDoc("short_9x16");
    doc.tracks[0].clips = [video("c1", 0, 2)];
    doc.tracks[1].clips = [text("t", 0, 4)];
    const withVideo = job(4, { doc, media: { files: { "prev-a": file("a.mp4") }, clips: { c1: { fileId: "prev-a" } } } });
    expect(await runPipeline(withVideo, io, control)).toEqual({ type: "failed", code: "decode", detail: "dispose failed" });
  });

  it("reports progress once a full interval has passed", async () => {
    const { io } = setup();
    const reports: number[] = [];
    let clock = -50;
    await runPipeline(job(6), io, { onProgress: (done) => { reports.push(done); }, now: () => (clock += 50) }); // 50 ms per frame
    expect(reports).toEqual([1, 3, 5, 6]);
  });
});
