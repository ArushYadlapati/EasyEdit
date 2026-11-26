// Cuts the background out of one picture: runs a portrait matting model (MODNet, transformers.js, WASM) on it and
// gives back a PNG with the background see-through. It makes no network request but for the model's files (Hugging
// Face, or NEXT_PUBLIC_SPEECH_MODEL_HOST) and the ONNX runtime, which the app serves from /ort/. The picture never
// leaves the browser.
import { env, pipeline, RawImage, type ProgressInfo } from "@huggingface/transformers";
import {
  CUTOUT_MODEL,
  CUTOUT_MODEL_BYTES,
  CUTOUT_MODEL_REVISION,
  cutoutSize,
  keptShare,
  pinnedCutoutUrl,
  type CutoutFailure,
  type FromCutout,
  type ToCutout,
} from "@/lib/media/cutout/protocol";

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";
const modelHost = process.env.NEXT_PUBLIC_SPEECH_MODEL_HOST;
if (modelHost) env.remoteHost = modelHost;
env.fetch = (input: string | URL, init?: RequestInit) => fetch(pinnedCutoutUrl(input), init);

const post = (message: FromCutout) => self.postMessage(message);

class Failure extends Error {
  constructor(
    readonly code: CutoutFailure,
    detail: string,
  ) {
    super(detail);
  }
}

async function cut(file: Blob): Promise<void> {
  let image: RawImage;
  try {
    image = await RawImage.fromBlob(file);
  } catch (error) {
    throw new Failure("undecodable", error instanceof Error ? error.message : String(error));
  }
  const size = cutoutSize(image.width, image.height);
  if (size.width !== image.width || size.height !== image.height) image = await image.resize(size.width, size.height);

  post({ type: "progress", stage: "model", done: 0, total: CUTOUT_MODEL_BYTES });
  // How much of each of the model's files is in, for one figure of the whole.
  const loaded = new Map<string, number>();
  let remove;
  try {
    remove = await pipeline("background-removal", CUTOUT_MODEL, {
      revision: CUTOUT_MODEL_REVISION,
      device: "wasm",
      dtype: "fp32",
      progress_callback: (info: ProgressInfo) => {
        if (info.status !== "progress") return;
        loaded.set(info.file, info.loaded);
        let done = 0;
        for (const bytes of loaded.values()) done += bytes;
        post({ type: "progress", stage: "model", done: Math.min(done, CUTOUT_MODEL_BYTES), total: CUTOUT_MODEL_BYTES });
      },
    });
  } catch (error) {
    throw new Failure("model", error instanceof Error ? error.message : String(error));
  }
  post({ type: "progress", stage: "cutting", done: 0, total: 1 });
  const out = (await remove(image)) as unknown as RawImage;
  const kept = keptShare(out.data as Uint8ClampedArray);
  // Nothing the model takes for a person: an empty picture would only look like a mistake.
  if (kept < 0.005) throw new Failure("nothing", "The model found no one in the picture.");
  const png = await out.toBlob("image/png");
  post({ type: "done", png, width: out.width, height: out.height, kept });
}

self.addEventListener("message", (event: MessageEvent<ToCutout>) => {
  if (event.data?.type !== "start") return;
  cut(event.data.file).catch((error: unknown) => {
    if (error instanceof Failure) post({ type: "failed", code: error.code, detail: error.message });
    else post({ type: "failed", code: "unknown", detail: error instanceof Error ? error.message : String(error) });
  });
});
