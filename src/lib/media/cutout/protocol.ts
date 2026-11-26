// Background removal for a picture: what the page and the cut-out worker (src/workers/cutout.worker.ts) say to each
// other. One worker cuts one picture.

// MODNet, a portrait matting model (Apache 2.0): it is made for people, and is unsure of anything else. The full
// model (26 MB), not the small one: on the same portrait the small one ate holes in the shoulders and frayed the
// hair's edge, and was no faster (1.5 s against 1.3 s, measured in Edge).
export const CUTOUT_MODEL = "Xenova/modnet";
export const CUTOUT_MODEL_REVISION = "fa2fa546052fba4c08921230a26cc69a333fca12";
export const CUTOUT_MODEL_BYTES = 25_888_640; // for the progress of the first fetch
export const CUTOUT_MAX_SIDE = 2048; // a larger picture is made this size first: the cut-out is a PNG, which grows fast

// The library asks for some of a model's files at the "main" address whatever revision it was given: every request
// goes to the pinned one (as the speech worker's do).
export function pinnedCutoutUrl(url: string | URL): string {
  return String(url).replace(`/${CUTOUT_MODEL}/resolve/main/`, `/${CUTOUT_MODEL}/resolve/${CUTOUT_MODEL_REVISION}/`);
}

export type CutoutFailure = "undecodable" | "model" | "nothing" | "unknown";
export type CutoutStage = "model" | "cutting";

export type ToCutout = { type: "start"; file: Blob };
export type FromCutout =
  | { type: "progress"; stage: CutoutStage; done: number; total: number } // model: bytes fetched
  | { type: "done"; png: Blob; width: number; height: number; kept: number } // kept: the share of the picture left showing
  | { type: "failed"; code: CutoutFailure; detail: string };

// The size a picture is cut at: its own, or with its longer side brought down to the most allowed.
export function cutoutSize(width: number, height: number, max = CUTOUT_MAX_SIDE): { width: number; height: number } {
  const longer = Math.max(width, height);
  if (longer <= max) return { width, height };
  const scale = max / longer;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// The share of a picture a cut-out leaves showing, from its alpha: each pixel counts for how solid it is.
export function keptShare(rgba: Uint8ClampedArray | Uint8Array): number {
  let sum = 0;
  for (let i = 3; i < rgba.length; i += 4) sum += rgba[i];
  return rgba.length === 0 ? 0 : sum / (255 * (rgba.length / 4));
}

// The cut-out's file name: the picture's, marked, as a PNG.
export function cutoutName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || "picture";
  return `${base.slice(0, 80)} (cut out).png`;
}
