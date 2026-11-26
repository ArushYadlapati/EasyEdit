"use client";

import { useCallback, useRef, useState } from "react";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { reframeOps, reframePlan } from "@/lib/editor/reframe";
import { interestBetween, interestPath, type Interest } from "@/lib/media/interest";
import { toGray, type Gray } from "@/lib/media/motion";
import { playbackFileFor } from "@/lib/media/playback";
import { useEditorStore } from "./context";
import { scanFrames } from "./media/frame-decode";
import { useMedia } from "./media/media-context";

const SCAN_SIDE = 96; // pixels on the longer side of the frames looked at
const LOOKS_A_SECOND = 10; // how often the picture is compared with itself: movement shows over a tenth of a second
const CALM_SECONDS = 0.6; // the path is evened out over about this long each way

// Reframe: reads the part of its file a video clip plays, finds where the movement is, and makes the clip fill the
// frame and follow it, as one change. The file is the one the preview plays, read from this browser's copy.
export function useReframe(): { run(clipId: string): Promise<void>; busy: boolean } {
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
      const clipNow = start.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      const plan = reframePlan(start.doc, clipId, clipNow && "assetId" in clipNow ? sizeOf(clipNow.assetId) : null);
      if (!plan.ok) return start.notify(plan.why === "fits" ? "info" : "error", plan.why === "locked" ? explainOpError("TRACK_LOCKED") : MESSAGES.reframeRefused[plan.why]);
      const { fps } = start.doc;
      const file = playbackFileFor(library.getState().assets[plan.clip.assetId]);
      running.current = true;
      setBusy(true);
      try {
        const got = file.fileId === null ? null : await files.get(file.fileId).catch(() => null);
        if (!got || !got.ok) return store.getState().notify("error", MESSAGES.reframeUnreadable);
        const looks: { seconds: number; interest: Interest | null }[] = [];
        let prev: Gray | null = null;
        let prevAt = -Infinity;
        const read = await scanFrames(got.blob, plan.first / fps, (plan.last + 1) / fps, SCAN_SIDE, (seconds, rgba, width, height) => {
          if (seconds - prevAt < 1 / LOOKS_A_SECOND - 1e-4) return;
          const gray = toGray(rgba, width, height);
          looks.push({ seconds, interest: prev ? interestBetween(prev, gray) : null });
          prev = gray;
          prevAt = seconds;
        }).catch(() => false);
        if (!read || looks.length < 3) return store.getState().notify("error", MESSAGES.reframeUnreadable);
        if (looks.every((look) => look.interest === null)) return store.getState().notify("info", MESSAGES.reframeStill);
        const path = interestPath(looks.map((look) => look.interest), CALM_SECONDS * LOOKS_A_SECOND);
        // The project may have changed while the file was read: the clip is planned again as it is now.
        const state = store.getState();
        const now = reframePlan(state.doc, clipId, sizeOf(plan.clip.assetId));
        if (!state.canEdit || !now.ok || now.clip.assetId !== plan.clip.assetId || now.clip.in !== plan.clip.in || now.clip.speed !== plan.clip.speed) return;
        const ops = reframeOps(now, path.map((place, i) => ({ sourceFrame: looks[i].seconds * fps, u: place.u, v: place.v })));
        if (ops.length === 0) return state.notify("error", MESSAGES.reframeUnreadable);
        const result = state.edit(ops, "reframe");
        state.notify(result.ok ? "info" : "error", result.ok ? MESSAGES.reframed : result.message);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store, library, files],
  );
  return { run, busy };
}
