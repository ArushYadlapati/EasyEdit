import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, createChunkBridge } from "@/lib/export/chunk-bridge";
import { EXPORT_MESSAGES, ExportError, failureMessage, failureOf, frameFailureMessage } from "@/lib/export/messages";
import type { FromWorker } from "@/lib/export/protocol";
import { tick } from "./fakes";

describe("failure messages", () => {
  it("has one plain sentence for every cause", () => {
    expect(EXPORT_MESSAGES).toEqual({
      unsupported: "This browser can't export video. Use a recent version of Chrome or Edge on a computer.",
      size: "This computer can't make a video at this size. Pick a smaller size.",
      empty: "This project is empty. Add a clip, then export.",
      font: "A font didn't load, so the export was stopped. Check your connection, reload the page and try again.",
      "font-mismatch": "Text would not look the same as in the preview, so the export was stopped. Reload the page and try again.",
      waiting: "Some media is still uploading or being prepared. Export once it's ready.",
      media: "A media file couldn't be read, so the export was stopped. Check your connection and try again.",
      decode: "A video clip couldn't be decoded in this browser, so the export was stopped.",
      encoder: "The video encoder stopped. Try again.",
      write: "The file couldn't be saved. Check that the disk has room and try again.",
      worker: "Export couldn't start. Reload the page and try again.",
      "too-long": "This video is too long to export in this browser. Use Chrome or Edge, or pick the draft size.",
      unknown: "Export didn't finish. Try again.",
    });
    for (const message of Object.values(EXPORT_MESSAGES)) expect(message).toMatch(/^[A-Z][^!]*\.$/);
    expect(failureMessage("encoder")).toBe("The video encoder stopped. Try again.");
  });

  it("says a frame wasn't saved, never that an export was stopped", () => {
    expect(frameFailureMessage("font")).toBe("A font didn't load, so the frame wasn't saved. Check your connection, reload the page and try again.");
    expect(frameFailureMessage("media")).toBe("A media file couldn't be read, so the frame wasn't saved. Check your connection and try again.");
    expect(frameFailureMessage("decode")).toBe("A video clip couldn't be decoded in this browser, so the frame wasn't saved.");
    expect(frameFailureMessage("waiting")).toBe("Some media is still uploading or being prepared. Save the frame once it's ready.");
    for (const code of ["unknown", "write", "worker", "encoder"] as const) expect(frameFailureMessage(code)).toBe("The frame couldn't be saved. Try again.");
  });

  it("an ExportError carries its cause, and anything else counts as the fallback", () => {
    const error = new ExportError("decode", "prev-a");
    expect([error instanceof Error, error.name, error.code, error.detail, error.message]).toEqual([true, "ExportError", "decode", "prev-a", "prev-a"]);
    expect(failureOf(error, "unknown")).toEqual({ code: "decode", detail: "prev-a" });
    expect(failureOf(new Error("boom"), "unknown")).toEqual({ code: "unknown", detail: "boom" });
    expect(failureOf("odd", "media")).toEqual({ code: "media", detail: "odd" });
  });
});

describe("the chunk hand-off", () => {
  it("sends one chunk at a time and waits for the page", async () => {
    const posted: { message: Extract<FromWorker, { type: "chunk" }>; transfer: Transferable[] }[] = [];
    const bridge = createChunkBridge((message, transfer) => posted.push({ message, transfer }));
    const writer = new WritableStream(bridge.sink).getWriter();
    const muxerBuffer = new Uint8Array([1, 2, 3, 4]);
    const first = writer.write({ type: "write", data: muxerBuffer, position: 0 });
    const second = writer.write({ type: "write", data: new Uint8Array([9]), position: 100 });
    await tick();
    expect(posted).toHaveLength(1); // the second waits for the first's answer
    const { message, transfer } = posted[0];
    expect(message).toMatchObject({ type: "chunk", seq: 0, position: 0 });
    expect([...message.data]).toEqual([1, 2, 3, 4]);
    expect(transfer).toEqual([message.data.buffer]);
    muxerBuffer[0] = 7; // the muxer reuses its buffer
    expect(message.data[0]).toBe(1); // the page got a copy

    bridge.ack(5); // not a chunk that was sent
    await tick();
    expect(posted).toHaveLength(1);
    bridge.ack(0);
    await first;
    await tick();
    expect(posted[1].message).toMatchObject({ seq: 1, position: 100 });
    bridge.ack(1);
    await second;
    expect(bridge.bytes()).toBe(101);
    // the muxer goes back to patch the start: the file is no longer than the furthest byte any chunk reached
    const patch = writer.write({ type: "write", data: new Uint8Array([7, 7]), position: 0 });
    await tick();
    bridge.ack(2);
    await patch;
    expect(bridge.bytes()).toBe(101);
    expect(CHUNK_BYTES).toBe(4 * 1024 * 1024);
  });
});
