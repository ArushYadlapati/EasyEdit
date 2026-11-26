"use client";

import { useCallback, useRef, useState } from "react";
import { decodeSound, type DecodedSound } from "@/lib/audio/decode";
import { isSure, matchSound, onsets } from "@/lib/audio/sync";
import { MESSAGES } from "@/lib/editor/messages";
import { placeAtOps, syncPlan } from "@/lib/editor/sound-sync";
import { findClip } from "@/lib/editor/store";
import { playbackFileFor } from "@/lib/media/playback";
import type { MediaClip, OpInput } from "@/lib/timeline";
import { useEditorStore } from "./context";
import { useMedia } from "./media/media-context";

// Sync by sound: listens to the selected clips and moves all but one so that their sound lines up with it, as one
// change. For a camera's video and a separate microphone's recording of the same take, or two cameras. The first
// video stays where it is. Each file is the one the preview plays, read from this browser's copy. A clip whose sound
// cannot be read, or that has nothing in common with the one that stays, is left where it is, and the notice says so.
export function useSyncSound(): { sync(clipIds: string[]): Promise<void>; busy: boolean } {
  const store = useEditorStore();
  const { library, files } = useMedia();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const sync = useCallback(
    async (clipIds: string[]) => {
      const start = store.getState();
      if (!start.canEdit || running.current) return;
      const plan = syncPlan(start.doc, clipIds);
      if (!plan) return start.notify("info", MESSAGES.syncNeedsTwo);
      running.current = true;
      setBusy(true);
      try {
        const { fps } = start.doc;
        const decoded = new Map<string, Promise<DecodedSound | null>>(); // each file is read once
        const read = (fileId: string) => {
          let sound = decoded.get(fileId);
          if (!sound) {
            sound = files.get(fileId).then(async (got) => {
              if (!got.ok) return null;
              const result = await decodeSound(got.blob);
              return result.ok ? result.sound : null;
            });
            decoded.set(fileId, sound);
          }
          return sound;
        };
        // Where the sounds of the part of its file a clip plays begin.
        const heard = async (clip: MediaClip) => {
          const asset = library.getState().assets[clip.assetId];
          const file = playbackFileFor(asset);
          const sound = file.fileId === null || asset?.hasAudio === false ? null : await read(file.fileId).catch(() => null);
          if (!sound) return null;
          const at = (frames: number) => (frames / fps) * sound.sampleRate;
          return onsets(sound.sides, sound.sampleRate, at(clip.in), at(clip.in + clip.duration));
        };
        const reference = await heard(plan.stays.clip);
        if (!reference) return store.getState().notify("error", MESSAGES.syncUnreadable);
        const wanted = new Map<string, number>(); // clip → the frame it should start on
        let unmatched = 0;
        for (const { clip, track } of plan.moves) {
          if (track.locked) continue;
          const mine = await heard(clip);
          const match = mine ? matchSound(reference, mine) : null;
          if (!match || !isSure(match)) unmatched += 1;
          else wanted.set(clip.id, plan.stays.clip.start + Math.round(match.seconds * fps));
        }
        // The project may have changed while the files were read: only clips still there, as they were, are moved.
        const state = store.getState();
        if (!state.canEdit) return;
        const ops: OpInput[] = [];
        let moved = 0;
        let inPlace = 0;
        for (const [clipId, to] of wanted) {
          const found = findClip(state.doc, clipId);
          const before = plan.moves.find((m) => m.clip.id === clipId)!.clip;
          if (!found || found.track.locked || (found.clip.type !== "video" && found.clip.type !== "audio")) continue;
          if (found.clip.start !== before.start || found.clip.in !== before.in) continue;
          const place = placeAtOps(found.clip, to);
          if (place === null) unmatched += 1;
          else if (place.length === 0) inPlace += 1;
          else {
            ops.push(...place);
            moved += 1;
          }
        }
        if (ops.length > 0) {
          // A clip that has no room where it belongs fails the whole change, and the editor says why.
          if (state.edit(ops, "sync by sound").ok) state.notify("info", MESSAGES.synced(moved, unmatched));
        } else if (inPlace > 0) state.notify("info", MESSAGES.alreadySynced);
        else state.notify("error", MESSAGES.syncNoMatch);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store, library, files],
  );

  return { sync, busy };
}
