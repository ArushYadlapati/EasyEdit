"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { runAutoCaptions, type AutoCaptionDeps, type AutoCaptionOutcome, type AutoCaptionProgress } from "@/lib/captions/actions";
import { browserTranscriber } from "@/lib/captions/speech/client";
import type { SpeechChoice } from "@/lib/captions/speech/languages";
import { fetchSavedTranscript, saveTranscriptToServer } from "@/lib/captions/transcript-client";
import type { BrandFonts } from "@/lib/brand/types";
import { useBrand } from "../brand/brand-context";
import { useEditorStore } from "../context";
import { useMedia, type MediaServices } from "../media/media-context";

// The real deps of Auto captions in this page: speech to text in a worker, the saved words on the server, and the
// editor's own media library and files. Nothing here starts until a run asks for it.
export function browserCaptionDeps(media: MediaServices, fonts: () => BrandFonts): AutoCaptionDeps {
  return {
    transcriber: browserTranscriber(),
    fetchSaved: fetchSavedTranscript,
    save: saveTranscriptToServer,
    files: media.files,
    assets: () => media.library.getState().assets,
    ensure: (ids) => media.library.getState().ensure(ids),
    fonts,
  };
}

// How long getting the speech model must take before the tab says it is a download: with the model already in the
// browser it takes well under this.
export const SLOW_MODEL_MS = 2000;

// One Auto captions run at a time. progress: where it is, null before the first step; slowModel: it has been getting the
// speech model for more than SLOW_MODEL_MS; outcome: how the last one ended.
export type AutoCaptionsRun = {
  running: boolean;
  progress: AutoCaptionProgress | null;
  slowModel: boolean;
  outcome: AutoCaptionOutcome | null;
  // speech: the language spoken and whether to write it in English; English as spoken when left out.
  start(opts?: { redo?: boolean; speech?: SpeechChoice }): void;
  cancel(): void;
};

type CaptionsValue = { deps: AutoCaptionDeps; run: AutoCaptionsRun };

const CaptionsContext = createContext<CaptionsValue | null>(null);

// Holds the run above the left panel, so it carries on, and shows where it is, when the person opens another tab and
// comes back. Leaving the editor cancels it. deps: tests pass fakes; without them the page's own are made.
export function CaptionsProvider({ deps: given, children }: { deps?: AutoCaptionDeps; children: ReactNode }) {
  const store = useEditorStore();
  const media = useMedia();
  const { fonts } = useBrand().kit;
  // A run uses the kit's fonts as they were when it started.
  const deps = useMemo(() => given ?? browserCaptionDeps(media, () => fonts), [given, media, fonts]);

  const [state, setState] = useState<Pick<AutoCaptionsRun, "running" | "progress" | "slowModel" | "outcome">>({ running: false, progress: null, slowModel: false, outcome: null });
  const controller = useRef<AbortController | null>(null);
  // The timer that marks the model stage as slow, and the last step seen, to tell when a model stage begins.
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<AutoCaptionProgress | null>(null);
  const stopSlowTimer = useCallback(() => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
  }, []);
  useEffect(
    () => () => {
      controller.current?.abort();
      stopSlowTimer();
    },
    [stopSlowTimer],
  );

  const onProgress = useCallback(
    (progress: AutoCaptionProgress) => {
      const inModel = progress.stage === "model";
      const begins = inModel && !(last.current?.stage === "model" && last.current.file === progress.file);
      last.current = progress;
      if (!inModel || begins) stopSlowTimer();
      if (begins) slowTimer.current = setTimeout(() => setState((s) => ({ ...s, slowModel: true })), SLOW_MODEL_MS);
      setState((s) => ({ ...s, progress, slowModel: inModel && !begins && s.slowModel }));
    },
    [stopSlowTimer],
  );

  const start = useCallback(
    (opts: { redo?: boolean; speech?: SpeechChoice } = {}) => {
      if (controller.current) return;
      const current = new AbortController();
      controller.current = current;
      last.current = null;
      setState({ running: true, progress: null, slowModel: false, outcome: null });
      void runAutoCaptions(store, deps, { redo: opts.redo, speech: opts.speech, signal: current.signal, onProgress }).then(
        (outcome) => {
          controller.current = null;
          stopSlowTimer();
          setState({ running: false, progress: null, slowModel: false, outcome });
          if (outcome.silent.length > 0) store.getState().notify("info", `No speech found in ${outcome.silent.join(", ")}.`);
        },
      );
    },
    [store, deps, onProgress, stopSlowTimer],
  );
  const cancel = useCallback(() => controller.current?.abort(), []);

  const value = useMemo(() => ({ deps, run: { ...state, start, cancel } }), [deps, state, start, cancel]);
  return <CaptionsContext value={value}>{children}</CaptionsContext>;
}

function useCaptionsContext(): CaptionsValue {
  const value = useContext(CaptionsContext);
  if (!value) throw new Error("The Captions tab must be inside a CaptionsProvider.");
  return value;
}

export function useCaptionDeps(): AutoCaptionDeps {
  return useCaptionsContext().deps;
}

export function useAutoCaptions(): AutoCaptionsRun {
  return useCaptionsContext().run;
}
