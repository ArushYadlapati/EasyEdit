import { CustomAudioEncoder, registerEncoder } from "mediabunny";
import { expect, it, vi } from "vitest";
import { canEncodeAac } from "@/lib/export/aac";

it("asks mediabunny with the export's exact sound settings, and counts an encoder registered later", async () => {
  expect(await canEncodeAac()).toBe(false); // Node has no AudioEncoder
  const seen: [string, AudioEncoderConfig][] = [];
  class Probe extends CustomAudioEncoder {
    static override supports(codec: string, config: AudioEncoderConfig) {
      seen.push([codec, config]);
      return true;
    }
    async init() {}
    async encode() {}
    async flush() {}
    async close() {}
  }
  registerEncoder(Probe);
  expect(await canEncodeAac()).toBe(true);
  expect(seen).toEqual([["aac", expect.objectContaining({ codec: "mp4a.40.2", numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000, aac: { format: "aac" } })]]);
});

it("answers no when mediabunny throws", async () => {
  vi.resetModules();
  vi.doMock("mediabunny", () => ({ Quality: class {}, canEncodeAudio: async () => { throw new TypeError("quality, when provided, must be a Quality."); } }));
  try {
    const { canEncodeAac: fresh } = await import("@/lib/export/aac");
    expect(await fresh()).toBe(false);
  } finally {
    vi.doUnmock("mediabunny");
  }
});
