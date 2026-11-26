"use client";

import { nanoid } from "nanoid";
import { useCallback, useRef, useState } from "react";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { createCutFinder, frameOfMoment, sceneSplitOps } from "@/lib/editor/scenes";
import { findClip } from "@/lib/editor/store";
import { playbackFileFor } from "@/lib/media/playback";
import { useEditorStore } from "./context";
import { scanFrames } from "./media/frame-decode";
import { useMedia } from "./media/media-context";

const SCAN_SIDE = 64; // pixels on the longer side: plenty to tell one shot from the next

// Split at scene changes: looks through the part of its file a video clip plays, finds where it cuts from one shot to
// the next, and splits the clip there, as one change. For footage that came in already edited, such as a screen
// recording of a call or a downloaded video. The file is the one the preview plays, read from this browser's copy.
export function useSceneSplit(): { split(clipId: string): Promise<void>; busy: boolean } {
  const store = useEditorStore();
  const { library, files } = useMedia();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const split = useCallback(
    async (clipId: string) => {
      const start = store.getState();
      const found = findClip(start.doc, clipId);
      if (!start.canEdit || running.current || !found || found.clip.type !== "video" || found.clip.speed <= 0) return;
      if (found.track.locked) return start.notify("error", explainOpError("TRACK_LOCKED"));
      const before = found.clip;
      const { fps } = start.doc;
      const file = playbackFileFor(library.getState().assets[before.assetId]);
      running.current = true;
      setBusy(true);
      try {
        const got = file.fileId === null ? null : await files.get(file.fileId).catch(() => null);
        if (!got || !got.ok) return store.getState().notify("error", MESSAGES.scenesUnreadable);
        const finder = createCutFinder();
        const from = before.in / fps;
        const to = (before.in + before.duration * before.speed) / fps;
        const read = await scanFrames(got.blob, from, to, SCAN_SIDE, (seconds, rgba, width, height) => finder.add(seconds, rgba, width, height)).catch(() => false);
        if (!read || finder.frames() < 2) return store.getState().notify("error", MESSAGES.scenesUnreadable);
        // The project may have changed while the file was read: only a clip that is still as it was is split.
        const state = store.getState();
        const now = findClip(state.doc, clipId);
        if (!state.canEdit || !now || now.track.locked || now.clip.type !== "video") return;
        const clip = now.clip;
        if (clip.start !== before.start || clip.in !== before.in || clip.duration !== before.duration || clip.speed !== before.speed) return;
        const { ops, clipIds } = sceneSplitOps(clip, finder.cuts().map((seconds) => frameOfMoment(clip, seconds, fps)), () => nanoid(10));
        if (ops.length === 0) return state.notify("info", MESSAGES.oneScene);
        if (state.edit(ops, "split at scene changes").ok) {
          state.select(clipIds);
          state.notify("info", MESSAGES.scenesSplit(clipIds.length));
        }
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store, library, files],
  );

  return { split, busy };
}
