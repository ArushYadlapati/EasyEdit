import type { MediaClip } from "@/lib/timeline";

// Which moment of its file a clip shows at a timeline frame, in the file's own seconds: the clip's in point plus the
// frames since its start, times its speed. An image has one moment. The preview, thumbnails, Save frame and the export
// all read the clock from here, so each frame of a file is the same one wherever it is drawn.
export function sourceSeconds(clip: MediaClip, frame: number, fps: number): number {
  if (clip.type === "image") return 0;
  return (clip.in + (frame - clip.start) * clip.speed) / fps;
}
