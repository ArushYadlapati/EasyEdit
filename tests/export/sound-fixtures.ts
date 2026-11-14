import type { AssetView } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";

// A project with every kind of sounding clip, and its assets.
// v1 [c1 0–30, c2 30–60] (asset a) · o1 [c3 0–60, asset z, opacity 0] · t1 [x1, x2] · cap · a1 [m1 0–90, asset song]
export function soundDoc(): TimelineDoc {
  const d = sampleDoc();
  d.tracks.splice(1, 0, {
    id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false,
    clips: [video("c3", 0, 60, { assetId: "z", transform: { ...DEFAULT_TRANSFORM, opacity: 0 } })],
  });
  d.tracks[4].clips = [video("m1", 0, 90, { type: "audio", assetId: "song" })];
  return d;
}

// A song: an audio asset plays its original.
export const SONG: AssetView = assetView({ id: "song", kind: "audio", originalFileId: "orig-song", previewStatus: "none", previewFileId: null });
// A second video, with its own preview copy.
export const Z: AssetView = assetView({ id: "z", originalFileId: "orig-z", previewFileId: "prev-z" });
