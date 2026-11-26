"use client";

import { useCallback, useRef, useState } from "react";
import { followOps, followPlan, pictureToFrame } from "@/lib/editor/follow";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { findClip } from "@/lib/editor/store";
import { follow, toGray, type Gray } from "@/lib/media/motion";
import { playbackFileFor } from "@/lib/media/playback";
import { sourceSeconds } from "@/lib/render/source-time";
import { useEditorStore } from "./context";
import { scanFrames } from "./media/frame-decode";
import { useMedia } from "./media/media-context";

const SCAN_SIDE = 256; // pixels on the longer side of the frames looked at: a face or a ball is still many pixels across

// Follow: reads the frames of the video under the selected text, shape or image, follows what is under its middle at
// the playhead forward and backward for as long as the clip and the video both last, and gives the clip position
// keyframes that keep it there, as one change. The file is the one the preview plays, read from this browser's copy.
export function useFollow(): { run(clipId: string): Promise<void>; busy: boolean } {
  const store = useEditorStore();
  const { library, files } = useMedia();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    async (clipId: string) => {
      const start = store.getState();
      if (!start.canEdit || running.current) return;
      const sizeOf = (assetId: string) => {
        const asset = library.getState().assets[assetId];
        return asset && asset.width && asset.height ? { width: asset.width, height: asset.height } : null;
      };
      const plan = followPlan(start.doc, clipId, start.playhead, (video) => sizeOf(video.assetId));
      if (!plan.ok) return start.notify(plan.why === "not-a-follower" ? "info" : "error", plan.why === "locked" ? explainOpError("TRACK_LOCKED") : MESSAGES.followRefused[plan.why]);
      const { video, follower } = plan;
      const { fps } = start.doc;
      const file = playbackFileFor(library.getState().assets[video.assetId]);
      running.current = true;
      setBusy(true);
      try {
        const got = file.fileId === null ? null : await files.get(file.fileId).catch(() => null);
        if (!got || !got.ok) return store.getState().notify("error", MESSAGES.followUnreadable);
        const frames: Gray[] = [];
        const times: number[] = [];
        const from = sourceSeconds(video, plan.from, fps);
        const to = sourceSeconds(video, plan.to, fps);
        const read = await scanFrames(got.blob, from, to, SCAN_SIDE, (seconds, rgba, width, height) => {
          frames.push(toGray(rgba, width, height));
          times.push(seconds);
        }).catch(() => false);
        if (!read || frames.length < 2) return store.getState().notify("error", MESSAGES.followUnreadable);
        // The frame of the file that shows at the playhead, and the place in it under the follower's middle.
        const wanted = sourceSeconds(video, plan.at, fps);
        let first = 0;
        for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - wanted) < Math.abs(times[first] - wanted)) first = i;
        const { width, height } = frames[0];
        const x0 = plan.u * (width - 1);
        const y0 = plan.v * (height - 1);
        const forward = follow(frames, first, x0, y0, 1);
        const backward = follow(frames, first, x0, y0, -1);
        const size = sizeOf(video.assetId);
        const placed = (i: number, at: { x: number; y: number }) => ({
          frame: video.start + (times[i] * fps - video.in) / video.speed,
          ...pictureToFrame(start.doc, video, size, at.x / (width - 1), at.y / (height - 1)),
        });
        const found = [...backward.map((at, k) => placed(first - k, at)), ...forward.slice(1).map((at, k) => placed(first + 1 + k, at))];
        // The project may have changed while the file was read: only a clip that is still where it was is given the path.
        const state = store.getState();
        const now = findClip(state.doc, clipId);
        if (!state.canEdit || !now || now.track.locked || now.clip.start !== follower.start || now.clip.duration !== follower.duration) return;
        const ops = followOps(now.clip, found);
        if (ops.length === 0) return state.notify("error", MESSAGES.followLost);
        if (!state.edit(ops, "follow").ok) return;
        const whole = backward.length + forward.length - 1 >= frames.length;
        state.notify("info", whole ? MESSAGES.followed : MESSAGES.followedPart(found.length / fps));
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store, library, files],
  );

  return { run, busy };
}
