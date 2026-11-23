"use client";

import { useCallback, useRef, useState } from "react";
import { decodeSound, type DecodedSound } from "@/lib/audio/decode";
import { levelVolume, measureLoudness } from "@/lib/audio/loudness";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { soundClipsOf } from "@/lib/editor/sound";
import { findClip } from "@/lib/editor/store";
import { playbackFileFor } from "@/lib/media/playback";
import type { OpInput } from "@/lib/timeline";
import { useEditorStore } from "./context";
import { useMedia } from "./media/media-context";

// Level volume: listens to the part of its file each clip plays and sets the clip's volume so that all of them come
// out equally loud, a quiet one turned up and a loud one down, as one change. The file is the one the preview plays,
// read from this browser's copy. A clip on a locked track, with no file to read or with nothing but silence is left as
// it is, and the notice says what happened. busy: a run is listening; a second one does not start until it ends.
export function useLevelVolume(): { level(clipIds: string[]): Promise<void>; busy: boolean } {
  const store = useEditorStore();
  const { library, files } = useMedia();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const level = useCallback(
    async (clipIds: string[]) => {
      const start = store.getState();
      if (!start.canEdit || running.current) return;
      const sounding = soundClipsOf(start.doc, clipIds);
      if (sounding.length === 0) return start.notify("info", MESSAGES.selectSoundClip);
      const clips = sounding.filter(({ track }) => !track.locked).map(({ clip }) => clip);
      if (clips.length === 0) return start.notify("error", explainOpError("TRACK_LOCKED"));
      running.current = true;
      setBusy(true);
      try {
        const { fps } = start.doc;
        const decoded = new Map<string, Promise<DecodedSound | null>>(); // each file is read once, however many clips use it
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
        const volumes = new Map<string, number>();
        let unreadable = 0; // the rest that get no volume had nothing but silence to measure
        for (const clip of clips) {
          if (clip.speed <= 0) continue; // plays backward or holds a frame: it has no sound to measure
          const asset = library.getState().assets[clip.assetId];
          const file = playbackFileFor(asset);
          const sound = file.fileId === null || asset?.hasAudio === false ? null : await read(file.fileId).catch(() => null);
          if (!sound) {
            unreadable += 1;
            continue;
          }
          const at = (frames: number) => (frames / fps) * sound.sampleRate;
          const measured = measureLoudness(sound.sides, sound.sampleRate, at(clip.in), at(clip.in + clip.duration * clip.speed));
          if (measured) volumes.set(clip.id, levelVolume(measured));
        }
        // The project may have changed while the files were read: only clips still there are set.
        const state = store.getState();
        if (!state.canEdit) return;
        let level = 0;
        const ops: OpInput[] = [];
        for (const [clipId, volume] of volumes) {
          const found = findClip(state.doc, clipId);
          if (!found || found.track.locked || (found.clip.type !== "video" && found.clip.type !== "audio")) continue;
          if (found.clip.volume === volume) level += 1;
          else ops.push({ op: "update_clip", clipId, patch: { volume } });
        }
        if (ops.length > 0) {
          if (state.edit(ops, "level volume").ok) state.notify("info", MESSAGES.leveled(ops.length));
        } else if (level > 0) state.notify("info", MESSAGES.alreadyLevel(level));
        else state.notify(unreadable > 0 ? "error" : "info", unreadable > 0 ? MESSAGES.levelUnreadable : MESSAGES.levelSilent);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store, library, files],
  );

  return { level, busy };
}
