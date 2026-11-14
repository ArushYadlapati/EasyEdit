import { afterEach, expect, it, vi } from "vitest";
import { canEncodeAac } from "@/lib/export/aac";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("asks this browser's AAC encoder with the export's exact sound settings, again at each call", async () => {
  const isConfigSupported = vi.fn(async () => ({ supported: true }));
  vi.stubGlobal("AudioEncoder", { isConfigSupported });
  expect(await canEncodeAac()).toBe(true);
  expect(isConfigSupported).toHaveBeenCalledWith({ codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 });
  isConfigSupported.mockResolvedValue({ supported: false });
  expect(await canEncodeAac()).toBe(false);
});

it("answers no without an AudioEncoder, and when the question throws", async () => {
  expect(await canEncodeAac()).toBe(false); // Node has none
  vi.stubGlobal("AudioEncoder", { isConfigSupported: async () => { throw new TypeError("bad config"); } });
  expect(await canEncodeAac()).toBe(false);
});
