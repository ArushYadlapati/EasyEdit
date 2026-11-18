import { describe, expect, it } from "vitest";
import { SPEECH_MODEL, SPEECH_MODEL_REVISION, pinnedModelUrl } from "@/lib/captions/speech/protocol";

const at = (host: string, revision: string, file: string) => `${host}${SPEECH_MODEL}/resolve/${revision}/${file}`;

describe("pinnedModelUrl", () => {
  it("sends a request for the model's moving address to the pinned revision", () => {
    const file = "onnx/decoder_model_merged_quantized.onnx";
    expect(pinnedModelUrl(at("https://huggingface.co/", "main", file))).toBe(at("https://huggingface.co/", SPEECH_MODEL_REVISION, file));
    expect(pinnedModelUrl(at("https://huggingface.co/", "main", "config.json"))).toBe(at("https://huggingface.co/", SPEECH_MODEL_REVISION, "config.json"));
  });

  it("does the same on another model host", () => {
    expect(pinnedModelUrl(at("https://models.example.test/files/", "main", "tokenizer.json"))).toBe(
      at("https://models.example.test/files/", SPEECH_MODEL_REVISION, "tokenizer.json"),
    );
  });

  it("takes a URL object", () => {
    expect(pinnedModelUrl(new URL(at("https://huggingface.co/", "main", "config.json")))).toBe(at("https://huggingface.co/", SPEECH_MODEL_REVISION, "config.json"));
  });

  it("leaves a request that is already pinned alone", () => {
    const url = at("https://huggingface.co/", SPEECH_MODEL_REVISION, "config.json");
    expect(pinnedModelUrl(url)).toBe(url);
  });

  it("leaves every other address alone", () => {
    for (const url of [
      "https://huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json",
      "https://us.aws.cdn.hf.co/xet-bridge-us/abc/def?x=1",
      "/ort/ort-wasm-simd-threaded.asyncify.wasm",
      `https://huggingface.co/${SPEECH_MODEL}/resolve/mainline/config.json`,
    ]) {
      expect(pinnedModelUrl(url)).toBe(url);
    }
  });
});
