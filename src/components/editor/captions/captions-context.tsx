"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { runAutoCaptions, type AutoCaptionDeps, type AutoCaptionOutcome, type AutoCaptionProgress } from "@/lib/captions/actions";
import { SPEECH_MODEL, browserTranscriber } from "@/lib/captions/speech/client";
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
    save: (assetId, words) => saveTranscriptToServer(assetId, words, SPEECH_MODEL),
    files: media.files,
    assets: () => media.library.getState().assets,
    ensure: (ids) => media.library.getState().ensure(ids),
    fonts,
  };
}

// One Auto captions run at a time. progress: where it is, null before the first step; outcome: how the last one ended.
export type AutoCaptionsRun = {
  running: boolean;
  progress: AutoCaptionProgress | null;
  outcome: AutoCaptionOutcome | null;
  start(opts?: { redo?: boolean }): void;
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

  const [state, setState] = useState<Pick<AutoCaptionsRun, "running" | "progress" | "outcome">>({ running: false, progress: null, outcome: null });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(
    (opts: { redo?: boolean } = {}) => {
      if (controller.current) return;
      const current = new AbortController();
      controller.current = current;
      setState({ running: true, progress: null, outcome: null });
      void runAutoCaptions(store, deps, { redo: opts.redo, signal: current.signal, onProgress: (progress) => setState((s) => ({ ...s, progress })) }).then(
        (outcome) => {
          controller.current = null;
          setState({ running: false, progress: null, outcome });
          if (outcome.silent.length > 0) store.getState().notify("info", `No speech found in ${outcome.silent.join(", ")}.`);
        },
      );
    },
    [store, deps],
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
