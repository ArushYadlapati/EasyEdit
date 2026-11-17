import { describe, expect, it } from "vitest";
import { createDecodePool, type MediaIO } from "@/lib/export/decode-pool";
import type { MediaSchedule, ScheduledClip } from "@/lib/export/media-schedule";
import type { ResolvedSource } from "@/lib/render/compositor";
import type { PictureSize } from "@/lib/render/decode-image";
import { fakeMediaIO, file, tick, type FakePicture } from "./fakes";

const v = (clipId: string, fileId: string, start: number, seconds: number[]): ScheduledClip =>
  ({ clipId, kind: "video", fileId, start, end: start + seconds.length, seconds });
const img = (clipId: string, fileId: string, start: number, end: number): ScheduledClip =>
  ({ clipId, kind: "image", fileId, start, end, seconds: [] });
const FILES = { a: file("a.mp4"), b: file("b.mp4"), logo: file("logo.png") };
const NATIVE = (_clipId: string, source: PictureSize): PictureSize => source; // every clip decoded at its source's size

// What each frame got: "clipId@moment" for a video picture, the clip id alone for an image.
async function walk(schedule: MediaSchedule, frames: number, io = fakeMediaIO()) {
  const pool = createDecodePool(schedule, FILES, io, NATIVE);
  await pool.open();
  const got: string[][] = [];
  for (let n = 0; n < frames; n++) {
    const pictures = await pool.frame(n);
    got.push([...pictures].map(([id, p]) => ("at" in p ? `${id}@${(p as FakePicture).at}` : id)));
  }
  return { pool, got, log: io.log };
}

describe("one picture per clip per frame", () => {
  it("opens each file once, and each clip walks its own times with its own reader", async () => {
    const { pool, got, log } = await walk({ clips: [v("c1", "a", 0, [2, 2.5, 3]), v("c2", "a", 3, [0, 0.5])], lastUse: { a: 4 } }, 5);
    expect(got).toEqual([["c1@2"], ["c1@2.5"], ["c1@3"], ["c2@0"], ["c2@0.5"]]);
    expect(log).toEqual(["can-decode a.mp4", "open a.mp4", "pictures a.mp4 from 2", "stop a.mp4 from 2", "pictures a.mp4 from 0"]);
    await pool.close();
    expect(log.slice(-2)).toEqual(["dispose a.mp4", "stop a.mp4 from 0"]); // close disposes first, then lets the readers go
  });

  it("gives two clips of one file at the same frame each their own reader and their own moments", async () => {
    const { got, log } = await walk({ clips: [v("c1", "a", 0, [0, 1, 2]), v("c3", "a", 0, [5, 6, 7])], lastUse: { a: 2 } }, 3);
    expect(got).toEqual([["c1@0", "c3@5"], ["c1@1", "c3@6"], ["c1@2", "c3@7"]]);
    expect(log).toEqual(["can-decode a.mp4", "open a.mp4", "pictures a.mp4 from 0", "pictures a.mp4 from 5"]);
  });

  it("floors each time at the file's first frame", async () => {
    const { got, log } = await walk({ clips: [v("c1", "a", 0, [0, 0.04, 0.1])], lastUse: { a: 2 } }, 3, fakeMediaIO({ firstTimestamp: 0.05 }));
    expect(got).toEqual([["c1@0.05"], ["c1@0.05"], ["c1@0.1"]]);
    expect(log).toContain("pictures a.mp4 from 0.05");
  });

  it("gives overlapping layers each their own picture, and waits for every one before giving the frame", async () => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0]), v("c3", "b", 0, [0]), img("i1", "logo", 0, 1)], lastUse: { a: 0, b: 0, logo: 0 } }, FILES, fakeMediaIO({ gate }), NATIVE);
    await pool.open();
    let settled = false;
    const frame = pool.frame(0).finally(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    open();
    expect([...(await frame).keys()]).toEqual(["c1", "c3", "i1"]);
  });

  it("decodes an image once per file, shares it, and closes it after its last frame", async () => {
    const io = fakeMediaIO();
    const pool = createDecodePool({ clips: [img("i1", "logo", 0, 2), img("i2", "logo", 1, 3), v("c1", "a", 0, [0, 1, 2, 3])], lastUse: { logo: 2, a: 3 } }, FILES, io, NATIVE);
    await pool.open();
    const frames: ReadonlyMap<string, unknown>[] = [];
    for (let n = 0; n < 4; n++) frames.push(await pool.frame(n));
    expect(frames[1].get("i1")).toBe(frames[1].get("i2"));
    expect([...frames[3].keys()]).toEqual(["c1"]);
    expect(io.log.filter((line) => /^(image|close)/.test(line))).toEqual(["image logo.png", "close logo.png"]);
    expect(io.log[0]).toBe("can-decode a.mp4"); // images are not checked up front
  });

  // Plan 5A relies on this: a moment past the file's end draws the file's last frame, never the placeholder. The sink
  // (mediabunny's canvasesAtTimestamps) gives the last frame there; the pool must pass it on, frame after frame.
  it("gives a clip its file's last frame for every moment past the end", async () => {
    const { got } = await walk({ clips: [v("c1", "a", 0, [0.5, 1, 1.5, 2])], lastUse: { a: 3 } }, 4, fakeMediaIO({ lastFrameAt: 1 }));
    expect(got).toEqual([["c1@0.5"], ["c1@1"], ["c1@1"], ["c1@1"]]);
  });

  it("leaves out a clip whose picture the decoder cannot give, so it draws its placeholder", async () => {
    const { got } = await walk({ clips: [v("c1", "a", 0, [0, 0.5, 1])], lastUse: { a: 2 } }, 3, fakeMediaIO({ missing: (_name, at) => at === 0.5 }));
    expect(got).toEqual([["c1@0"], [], ["c1@1"]]);
    const ended = await walk({ clips: [v("c1", "a", 0, [0, 0.5, 1])], lastUse: { a: 2 } }, 3, fakeMediaIO({ ends: (_name, at) => at >= 0.5 }));
    expect(ended.got).toEqual([["c1@0"], [], []]); // a reader that has finished gives nothing more
  });

  it("releases a reader when its clip ends and a file after its last use, and opens the next file as its clip starts", async () => {
    const { log } = await walk({ clips: [v("c1", "a", 0, [0, 0.5]), v("c3", "b", 2, [1, 1.5])], lastUse: { a: 1, b: 3 } }, 4);
    expect(log).toEqual([
      "can-decode a.mp4", "can-decode b.mp4", "open a.mp4", "pictures a.mp4 from 0",
      "stop a.mp4 from 0", "dispose a.mp4", "open b.mp4", "pictures b.mp4 from 1",
    ]);
  });

  it("gives a frame's pictures in drawing order, images and videos alike", async () => {
    const { got } = await walk({ clips: [img("i1", "logo", 0, 1), v("c1", "a", 0, [0])], lastUse: { logo: 0, a: 0 } }, 1);
    expect(got).toEqual([["i1", "c1@0"]]);
  });
});

describe("the size each picture is decoded at", () => {
  it("decodes each clip of a video at its own size, asked with the file's upright size", async () => {
    const asked: string[] = [];
    const sizeOf = (clipId: string, source: PictureSize) => {
      asked.push(`${clipId} ${source.width}x${source.height}`);
      return clipId === "pip" ? { width: 640, height: 360 } : source;
    };
    const io = fakeMediaIO({ videoSize: { width: 1280, height: 720 } });
    const pool = createDecodePool({ clips: [v("full", "a", 0, [0, 1]), v("pip", "a", 0, [5, 6])], lastUse: { a: 1 } }, FILES, io, sizeOf);
    await pool.open();
    const pictures = await pool.frame(0);
    expect(io.sizes).toEqual(["a.mp4 from 0 1280x720", "a.mp4 from 5 640x360"]);
    expect(asked).toEqual(["full 1280x720", "pip 1280x720"]);
    expect(pictures.get("pip")).toMatchObject({ width: 640, height: 360 });
  });

  // One decoded image is shared by every clip of its file until its last use, so it is decoded at the largest size any
  // of them needs, a clip that starts later included. Videos need no such rule: each clip has its own reader.
  it("decodes an image shared by several clips at the largest size any of them needs", async () => {
    const sizeOf = (clipId: string, source: PictureSize) =>
      clipId === "big" ? source : { width: Math.ceil(source.width / 4), height: Math.ceil(source.height / 4) };
    const io = fakeMediaIO({ imageSize: { width: 4000, height: 3000 } });
    const pool = createDecodePool({ clips: [img("small", "logo", 0, 10), img("big", "logo", 5, 10)], lastUse: { logo: 9 } }, FILES, io, sizeOf);
    await pool.open();
    expect((await pool.frame(0)).get("small")).toMatchObject({ width: 4000, height: 3000 });
    expect(io.sizes).toEqual(["logo.png 4000x3000"]);
  });

  it("decodes an image used by one clip at that clip's size", async () => {
    const io = fakeMediaIO({ imageSize: { width: 4000, height: 3000 } });
    const pool = createDecodePool({ clips: [img("i1", "logo", 0, 1)], lastUse: { logo: 0 } }, FILES, io, () => ({ width: 1000, height: 750 }));
    await pool.open();
    await pool.frame(0);
    expect(io.sizes).toEqual(["logo.png 1000x750"]);
  });
});

describe("what stops it", () => {
  it("stops before the first frame when a video cannot be decoded in this browser, or its bytes are missing", async () => {
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0]), v("c3", "b", 1, [0])], lastUse: { a: 0, b: 1 } }, FILES, fakeMediaIO({ decodable: (name) => name !== "b.mp4" }), NATIVE);
    await expect(pool.open()).rejects.toMatchObject({ name: "ExportError", code: "decode", detail: "b" });
    const lost = createDecodePool({ clips: [v("c9", "gone", 0, [0])], lastUse: { gone: 0 } }, FILES, fakeMediaIO(), NATIVE);
    await expect(lost.open()).rejects.toMatchObject({ code: "media", detail: "gone" });
  });

  it("a video file that cannot be read when it is checked is a media failure, not a decode one", async () => {
    const unreadable: MediaIO = { ...fakeMediaIO(), canDecode: async () => { throw new DOMException("gone", "NotReadableError"); } };
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0])], lastUse: { a: 0 } }, FILES, unreadable, NATIVE);
    await expect(pool.open()).rejects.toMatchObject({ name: "ExportError", code: "media", detail: "gone" });
  });

  // Added beyond the brief: the check's other causes are named as a reader's are.
  it("names any other failure of the check by its cause: a decoder the browser took back, or anything else", async () => {
    const causes = [[new DOMException("reclaimed", "QuotaExceededError"), "encoder"], [new Error("odd"), "decode"]] as const;
    for (const [error, code] of causes) {
      const io: MediaIO = { ...fakeMediaIO(), canDecode: async () => { throw error; } };
      const pool = createDecodePool({ clips: [v("c1", "a", 0, [0])], lastUse: { a: 0 } }, FILES, io, NATIVE);
      await expect(pool.open(), error.name).rejects.toMatchObject({ name: "ExportError", code, detail: error.message });
    }
  });

  it("a reader that breaks is a decode failure; a file that cannot be opened or an image that cannot be decoded is a media failure", async () => {
    const breaking = createDecodePool({ clips: [v("c1", "a", 0, [0, 0.5])], lastUse: { a: 1 } }, FILES, fakeMediaIO({ breaks: (_name, at) => at === 0.5 }), NATIVE);
    await breaking.open();
    await breaking.frame(0);
    await expect(breaking.frame(1)).rejects.toMatchObject({ code: "decode", detail: "decoder closed" });
    for (const clip of [v("c1", "a", 0, [0]), img("i1", "logo", 0, 1)]) {
      const pool = createDecodePool({ clips: [clip], lastUse: { [clip.fileId]: 0 } }, FILES, fakeMediaIO({ unreadable: () => true }), NATIVE);
      await pool.open();
      await expect(pool.frame(0)).rejects.toMatchObject({ code: "media", detail: "unreadable" });
    }
    const noImage = createDecodePool({ clips: [img("i1", "nope", 0, 1)], lastUse: { nope: 0 } }, FILES, fakeMediaIO(), NATIVE);
    await noImage.open(); // images are not checked up front
    await expect(noImage.frame(0)).rejects.toMatchObject({ code: "media", detail: "nope" });
  });

  it("names a reader's failure by its cause: a file that went away, a decoder the browser took back", async () => {
    const causes = [
      [new DOMException("gone", "NotReadableError"), "media"],
      [new DOMException("gone", "NotFoundError"), "media"],
      [new DOMException("reclaimed", "QuotaExceededError"), "encoder"],
      [new Error("bad frame"), "decode"],
    ] as const;
    for (const [error, code] of causes) {
      const io = fakeMediaIO({ rejectsWith: (_name, at) => (at === 0.5 ? error : null) });
      const pool = createDecodePool({ clips: [v("c1", "a", 0, [0, 0.5])], lastUse: { a: 1 } }, FILES, io, NATIVE);
      await pool.open();
      await pool.frame(0);
      await expect(pool.frame(1), error.name).rejects.toMatchObject({ name: "ExportError", code });
    }
  });

  it("a reader whose file was disposed under it is a media failure", async () => {
    const disposed = Object.assign(new Error("Input has been disposed."), { name: "InputDisposedError" });
    const io = fakeMediaIO({ rejectsWith: (_name, at) => (at === 0.5 ? disposed : null) });
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0, 0.5])], lastUse: { a: 1 } }, FILES, io, NATIVE);
    await pool.open();
    await pool.frame(0);
    await expect(pool.frame(1)).rejects.toMatchObject({ code: "media", detail: "Input has been disposed." });
  });

  it("ends the frame when one reader breaks while another never answers", async () => {
    const io = fakeMediaIO({ hangs: (name) => name === "a.mp4", breaks: (name) => name === "b.mp4" });
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0]), v("c3", "b", 0, [0])], lastUse: { a: 0, b: 0 } }, FILES, io, NATIVE);
    await pool.open();
    const frame = pool.frame(0).then(() => "answered", (error: { code: string }) => error.code);
    expect(await Promise.race([frame, tick().then(() => "still waiting")])).toBe("decode");
  });

  it("close does not wait for a reader that never answers", async () => {
    const io = fakeMediaIO({ hangs: () => true });
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0])], lastUse: { a: 0 } }, FILES, io, NATIVE);
    await pool.open();
    void pool.frame(0);
    await tick();
    await pool.close();
    expect(io.log.slice(-2)).toEqual(["dispose a.mp4", "stop a.mp4 from 0"]);
  });

  it("close releases everything still open, once", async () => {
    const io = fakeMediaIO();
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0, 1]), v("c3", "b", 0, [0, 1]), img("i1", "logo", 0, 2)], lastUse: { a: 1, b: 1, logo: 1 } }, FILES, io, NATIVE);
    await pool.open();
    await pool.frame(0);
    const before = io.log.length;
    await pool.close();
    expect(io.log.slice(before).sort()).toEqual(["close logo.png", "dispose a.mp4", "dispose b.mp4", "stop a.mp4 from 0", "stop b.mp4 from 0"]);
    await pool.close();
    await createDecodePool({ clips: [], lastUse: {} }, FILES, io, NATIVE).close();
    expect(io.log).toHaveLength(before + 5);
  });

  it("close resolves when releasing fails, and waits on no reader's return", async () => {
    // a.mp4's reader acts as an async generator does with a next() still pending: its return() never settles.
    // b.mp4's return() rejects, logo.png's close() and every dispose() throw.
    const returns: Record<string, () => Promise<IteratorResult<ResolvedSource | null>>> = {
      "a.mp4": () => new Promise(() => {}),
      "b.mp4": () => Promise.reject(new Error("decoder closed")),
    };
    const fails = () => { throw new Error("already gone"); };
    const io: MediaIO = {
      canDecode: async () => true,
      openVideo: async (blob) => ({
        firstTimestamp: 0,
        width: 1280,
        height: 720,
        pictures: () => ({ next: async () => ({ done: false, value: null }), return: returns[(blob as File).name] }),
        dispose: fails,
      }),
      decodeImage: async () => ({ image: {} as CanvasImageSource, width: 400, height: 300, close: fails }),
    };
    const pool = createDecodePool({ clips: [v("c1", "a", 0, [0]), v("c3", "b", 0, [0]), img("i1", "logo", 0, 1)], lastUse: { a: 0, b: 0, logo: 0 } }, FILES, io, NATIVE);
    await pool.open();
    await pool.frame(0);
    const closing = pool.close().then(() => "closed", () => "rejected");
    expect(await Promise.race([closing, tick().then(() => "still waiting")])).toBe("closed");
  });
});
