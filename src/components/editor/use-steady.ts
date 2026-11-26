"use client";

import { useCallback, useRef, useState } from "react";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { findClip } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import { shiftBetween, toGray, type Gray } from "@/lib/media/motion";
import { playbackFileFor } from "@/lib/media/playback";
import { STEADY_STRENGTHS, cameraPath, packMoves, steadyMoves, type Shift, type SteadyStrength } from "@/lib/media/steady";
import { useEditorStore } from "./context";
import { scanFrames } from "./media/frame-decode";
import { useMedia } from "./media/media-context";

const SCAN_SIDE = 192; // pixels on the longer side of the frames looked at
const UNREAD_MOST = 1 / 3; // the share of frames whose motion may go unread before the clip is left alone

// Stabilize: reads the part of its file a video clip plays, works out how the camera moved from each frame to the
// next, and keeps on the clip the moves that take the shake out, as one change. The file is the one the preview
// plays, read from this browser's copy. off: takes the steadying off again.
export function useSteady(): { run(clipId: string, strength: SteadyStrength): Promise<void>; off(clipId: string): void; busy: boolean } {
  const store = useEditorStore();
  const { library, files } = useMedia();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    async (clipId: string, strength: SteadyStrength) => {
      const start = store.getState();
      const found = findClip(start.doc, clipId);
      if (!start.canEdit || running.current || !found || found.clip.type !== "video" || found.clip.speed === 0) return;
      if (found.track.locked) return start.notify("error", explainOpError("TRACK_LOCKED"));
      const before = found.clip;
      const { fps } = start.doc;
      // The frames of its file it plays, whichever way it runs.
      const ends = [before.in, before.in + before.duration * before.speed];
      const first = Math.max(0, Math.round(Math.min(...ends)));
      const last = Math.round(Math.max(...ends));
      if (last - first + 1 > LIMITS.steadyFrames) return start.notify("error", MESSAGES.steadyTooLong);
      const file = playbackFileFor(library.getState().assets[before.assetId]);
      running.current = true;
      setBusy(true);
      try {
        const got = file.fileId === null ? null : await files.get(file.fileId).catch(() => null);
        if (!got || !got.ok) return store.getState().notify("error", MESSAGES.steadyUnreadable);
        const times: number[] = [];
        const shifts: (Shift | null)[] = [];
        let prev: Gray | null = null;
        const read = await scanFrames(got.blob, first / fps, (last + 1) / fps, SCAN_SIDE, (seconds, rgba, width, height) => {
          const gray = toGray(rgba, width, height);
          if (prev) {
            const shift = shiftBetween(prev, gray);
            shifts.push(shift && { dx: shift.dx / width, dy: shift.dy / height });
          }
          times.push(seconds);
          prev = gray;
        }).catch(() => false);
        if (!read || times.length < 3) return store.getState().notify("error", MESSAGES.steadyUnreadable);
        // Where the picture has too little in it to tell how it moved (flat colour, a clear sky, the dark), a guess
        // would shake it more, not less: with a third of the frames unread, nothing is changed.
        if (shifts.filter((shift) => shift === null).length > shifts.length * UNREAD_MOST) return store.getState().notify("error", MESSAGES.steadyUnsure);
        const perSecond = (times.length - 1) / Math.max(1e-6, times[times.length - 1] - times[0]);
        const { moves, zoom } = steadyMoves(cameraPath(shifts), Math.max(1, Math.round(STEADY_STRENGTHS[strength] * perSecond)));
        if (zoom <= 1.002) return store.getState().notify("info", MESSAGES.steadyAlready);
        // One move for each frame of the file as the project counts them: that of the frame read nearest to it.
        const byFrame: Shift[] = [];
        let at = 0;
        for (let frame = first; frame <= last; frame++) {
          const wanted = frame / fps;
          while (at + 1 < times.length && Math.abs(times[at + 1] - wanted) <= Math.abs(times[at] - wanted)) at++;
          byFrame.push(moves[at]);
        }
        // The project may have changed while the file was read: only a clip that still plays the same file is steadied.
        const state = store.getState();
        const now = findClip(state.doc, clipId);
        if (!state.canEdit || !now || now.track.locked || now.clip.type !== "video" || now.clip.assetId !== before.assetId) return;
        const steady = { from: first, zoom, data: packMoves(byFrame) };
        if (state.edit([{ op: "update_clip", clipId, patch: { steady } }], "stabilize").ok) state.notify("info", MESSAGES.steadied(zoom));
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store, library, files],
  );

  const off = useCallback(
    (clipId: string) => {
      const state = store.getState();
      const found = findClip(state.doc, clipId);
      if (!state.canEdit || !found || found.clip.type !== "video" || !found.clip.steady) return;
      state.edit([{ op: "update_clip", clipId, patch: { steady: null } }], "remove stabilizing");
    },
    [store],
  );

  return { run, off, busy };
}
