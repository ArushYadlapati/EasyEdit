import { describe, expect, it, vi } from "vitest";
import { CutoutError, createCutter, type CutoutWorker } from "@/lib/media/cutout/client";
import { CUTOUT_MODEL, CUTOUT_MODEL_REVISION, cutoutName, cutoutSize, keptShare, pinnedCutoutUrl, type FromCutout } from "@/lib/media/cutout/protocol";

// A worker that answers what the test tells it to.
function pretendWorker() {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: (type: string, listener: (event: unknown) => void) => void (listeners[type] ??= []).push(listener),
  } as unknown as CutoutWorker & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> };
  const say = (message: FromCutout) => listeners.message?.forEach((listener) => listener({ data: message }));
  const breaks = () => listeners.error?.forEach((listener) => listener({}));
  return { worker, say, breaks };
}

describe("the picture's size", () => {
  it("is its own up to 2048 on its longer side, and brought down to that past it", () => {
    expect(cutoutSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(cutoutSize(2048, 2048)).toEqual({ width: 2048, height: 2048 });
    expect(cutoutSize(4096, 3072)).toEqual({ width: 2048, height: 1536 });
    expect(cutoutSize(3000, 6000)).toEqual({ width: 1024, height: 2048 });
    expect(cutoutSize(10_000, 3)).toEqual({ width: 2048, height: 1 });
  });
});

describe("what a cut-out keeps", () => {
  it("is the share of the picture left showing, by how solid each pixel is", () => {
    expect(keptShare(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0]))).toBe(0.5);
    expect(keptShare(new Uint8Array([9, 9, 9, 255, 9, 9, 9, 255]))).toBe(1);
    expect(keptShare(new Uint8Array([9, 9, 9, 51]))).toBeCloseTo(0.2);
    expect(keptShare(new Uint8Array([]))).toBe(0);
  });
});

describe("names and addresses", () => {
  it("names the cut-out after the picture, as a PNG", () => {
    expect(cutoutName("team photo.jpg")).toBe("team photo (cut out).png");
    expect(cutoutName("driver")).toBe("driver (cut out).png");
    expect(cutoutName(".png")).toBe("picture (cut out).png");
    expect(cutoutName(`${"x".repeat(200)}.jpeg`)).toHaveLength(80 + " (cut out).png".length);
  });
  it("sends every request for the model to its pinned revision", () => {
    expect(pinnedCutoutUrl(`https://huggingface.co/${CUTOUT_MODEL}/resolve/main/onnx/model.onnx`)).toBe(`https://huggingface.co/${CUTOUT_MODEL}/resolve/${CUTOUT_MODEL_REVISION}/onnx/model.onnx`);
    const pinned = `https://huggingface.co/${CUTOUT_MODEL}/resolve/${CUTOUT_MODEL_REVISION}/config.json`;
    expect(pinnedCutoutUrl(pinned)).toBe(pinned);
    expect(pinnedCutoutUrl(new URL("https://example.com/other/resolve/main/x"))).toBe("https://example.com/other/resolve/main/x");
  });
});

describe("the cutter", () => {
  it("starts a worker with the picture, passes its progress on, and gives the cut-out", async () => {
    const { worker, say } = pretendWorker();
    const seen: unknown[] = [];
    const file = new Blob(["jpeg"]);
    const cutting = createCutter(() => worker).cut(file, { onProgress: (p) => seen.push(p) });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "start", file });
    say({ type: "progress", stage: "model", done: 5, total: 10 });
    say({ type: "progress", stage: "cutting", done: 0, total: 1 });
    const png = new Blob(["png"]);
    say({ type: "done", png, width: 30, height: 20, kept: 0.4 });
    expect(await cutting).toEqual({ png, width: 30, height: 20, kept: 0.4 });
    expect(seen).toEqual([{ stage: "model", done: 5, total: 10 }, { stage: "cutting", done: 0, total: 1 }]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("fails with the worker's reason, or when the worker stops, and ends the worker either way", async () => {
    const refused = pretendWorker();
    const first = createCutter(() => refused.worker).cut(new Blob());
    refused.say({ type: "failed", code: "nothing", detail: "no one" });
    await expect(first).rejects.toMatchObject({ code: "nothing", message: "no one" });
    expect(refused.worker.terminate).toHaveBeenCalledTimes(1);
    const broken = pretendWorker();
    const second = createCutter(() => broken.worker).cut(new Blob());
    broken.breaks();
    await expect(second).rejects.toBeInstanceOf(CutoutError);
    await expect(createCutter(() => { throw new Error("no workers here"); }).cut(new Blob())).rejects.toMatchObject({ code: "unknown", message: "no workers here" });
  });
  it("a cancel stops the worker at once, and nothing it says later counts", async () => {
    const { worker, say } = pretendWorker();
    const control = new AbortController();
    const cutting = createCutter(() => worker).cut(new Blob(), { signal: control.signal });
    control.abort();
    say({ type: "done", png: new Blob(), width: 1, height: 1, kept: 1 });
    await expect(cutting).rejects.toMatchObject({ code: "cancelled" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const already = new AbortController();
    already.abort();
    const started = vi.fn();
    await expect(createCutter(started).cut(new Blob(), { signal: already.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(started).not.toHaveBeenCalled();
  });
});
