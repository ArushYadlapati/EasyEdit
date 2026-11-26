"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cutOutClip, uploadOutcome, type CutoutStep } from "@/lib/editor/cutout";
import { browserCutter, type Cutter } from "@/lib/media/cutout/client";
import { useEditorStore } from "./context";
import { useMedia } from "./media/media-context";

// Remove background for the inspector: runs it for a clip, says how far it is, and can be cancelled. One at a time.
// cutter: the real one (a worker with the model) unless one is given, as in tests.
export function useCutout(cutter?: Cutter): { run(clipId: string): Promise<void>; cancel(): void; step: CutoutStep | null } {
  const store = useEditorStore();
  const { library, files, queue } = useMedia();
  const [step, setStep] = useState<CutoutStep | null>(null);
  const running = useRef<AbortController | null>(null);

  // Leaving the clip's inspector stops the model; an upload already begun carries on in the Media tab.
  useEffect(() => () => running.current?.abort(), []);

  const run = useCallback(
    async (clipId: string) => {
      if (running.current) return;
      const control = (running.current = new AbortController());
      try {
        await cutOutClip(
          {
            store,
            asset: (assetId) => library.getState().assets[assetId],
            readFile: async (fileId) => {
              const got = await files.get(fileId);
              return got.ok ? got.blob : null;
            },
            cutter: cutter ?? browserCutter(),
            upload: (file) => queue.add([file])[0] ?? null,
            uploaded: (key, signal) =>
              new Promise<string | null>((resolve) => {
                const check = () => {
                  const outcome = signal.aborted ? null : uploadOutcome(library.getState(), key);
                  if (outcome === undefined) return false;
                  stop();
                  signal.removeEventListener("abort", check);
                  resolve(outcome);
                  return true;
                };
                const stop = library.subscribe(() => void check());
                signal.addEventListener("abort", check, { once: true });
                check();
              }),
          },
          clipId,
          { signal: control.signal, onStep: (next) => !control.signal.aborted && setStep(next) },
        );
      } finally {
        if (running.current === control) running.current = null;
        setStep(null);
      }
    },
    [store, library, files, queue, cutter],
  );
  const cancel = useCallback(() => running.current?.abort(), []);
  return { run, cancel, step };
}
