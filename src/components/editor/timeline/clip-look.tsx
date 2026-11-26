"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { waveColumns, type Peaks } from "@/lib/audio/peaks";
import { clipSpanSeconds, createClipLooks, stripTiles, type ClipLooks, type LookKind, type Strip, stripGone } from "@/lib/media/clip-looks";
import type { MediaFiles } from "@/lib/media/media-files";
import { playbackFileFor } from "@/lib/media/playback";
import type { MediaClip } from "@/lib/timeline";
import { dropStrip, makePeaks, makeStrip } from "../media/make-looks";
import { useLibrary, useMedia } from "../media/media-context";

// One set of looks per set of media files, as the stills have: two editors never share a strip.
const LOOKS = new WeakMap<MediaFiles, ClipLooks>();

function looksFor(files: MediaFiles): ClipLooks {
  let looks = LOOKS.get(files);
  if (!looks) {
    looks = createClipLooks({ files, makeStrip, makePeaks, dropStrip });
    LOOKS.set(files, looks);
  }
  return looks;
}

const MAX_CANVAS_PX = 4096; // a wider clip stretches its drawing instead of making a huge canvas
const VEIL = "rgba(0,0,0,0.35)"; // over a strip, so the clip's name stays readable
const WAVE = "rgba(255,255,255,0.55)";

// A video clip's strip, or an audio clip's peaks, once made: null until then, for a clip with nothing to play, and
// when `show` is off. While mounted with `show` on it holds the look, so it is made and kept.
export function useClipLook(clip: MediaClip, show: boolean): Strip | Peaks | null {
  const kind: LookKind = clip.type === "video" ? "strip" : "peaks";
  const fileId = useLibrary((s) => {
    if (!show || clip.type === "image") return null;
    const asset = s.assets[clip.assetId];
    return kind === "peaks" && asset?.hasAudio === false ? null : playbackFileFor(asset).fileId;
  });
  const looks = looksFor(useMedia().files);
  const look = useSyncExternalStore(
    looks.subscribe,
    () => (fileId === null ? null : kind === "strip" ? looks.strip(fileId) : looks.peaks(fileId)),
    () => null,
  );
  useEffect(() => (fileId === null ? undefined : looks.hold(fileId, kind)), [looks, fileId, kind]);
  return look;
}

const isStrip = (look: Strip | Peaks): look is Strip => "tiles" in look;

// The look drawn across the whole clip, under its name and marks: a video's frames side by side, each the frame its
// left edge plays, or a sound's shape. It follows the clip's trim, speed and way round, and the timeline's zoom.
export function ClipLook({ clip, look, fps, width, height }: { clip: MediaClip; look: Strip | Peaks; fps: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { start, duration, speed, volume, type } = clip;
  const sourceIn = clip.in;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const shown = Math.min(width, MAX_CANVAS_PX);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(shown * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const timing = { start, duration, speed, in: sourceIn, type } as MediaClip;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isStrip(look)) {
      // A strip freed a moment ago draws nothing: the clip is plain until its own strip comes (stripGone).
      if (stripGone(look)) return;
      // Drawn in the clip's own pixels and squeezed sideways onto the canvas, which CSS stretches back.
      const squeeze = shown / width;
      for (const tile of stripTiles(timing, fps, duration / width, width, height, look)) {
        const sx = (tile.tile % look.columns) * look.tileWidth;
        const sy = Math.floor(tile.tile / look.columns) * look.tileHeight;
        ctx.drawImage(look.image, sx, sy, look.tileWidth, look.tileHeight, tile.x * squeeze * dpr, 0, tile.width * squeeze * dpr, canvas.height);
      }
      ctx.fillStyle = VEIL;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const { from, to } = clipSpanSeconds(timing, fps);
    const bars = waveColumns(look, from, to, canvas.width);
    const loud = Math.min(1, volume); // a clip turned down draws smaller; one turned up is already as tall as it gets
    ctx.fillStyle = WAVE;
    bars.forEach((bar, x) => {
      const h = Math.max(dpr, bar * loud * canvas.height);
      ctx.fillRect(x, (canvas.height - h) / 2, 1, h);
    });
  }, [look, fps, width, height, start, duration, speed, sourceIn, volume, type]);
  return <canvas ref={ref} aria-hidden data-clip-look={isStrip(look) ? "strip" : "peaks"} className="pointer-events-none absolute inset-0 size-full" />;
}
