"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetView } from "@/lib/media/types";
import { failAnalysis, saveAnalysis } from "@/lib/style/client";
import { STYLE_WORDS } from "@/lib/style/messages";
import type { StyleReference } from "@/lib/style/types";
import { useMedia } from "../editor/media/media-context";
import { analyzeVideo, browserAnalyzeDeps, failureReason, type AnalyzeDeps, type AnalyzeStage } from "./analyze-video";

// Where one video reference has got to: waiting while another is looked at first, then each step of looking it over
// and saving what was found. done: from 0 to 1, for the step.
export type ReferenceProgress = { stage: "waiting" | AnalyzeStage; done: number };

// Looks over the style's video references in this browser, one at a time, and saves what it finds.
// run: queues a reference (with its video) and resolves once it is done or canceled; a reference already queued is
// not queued twice. progress: every reference queued or being looked at, by id. cancel: takes one out of the queue,
// or stops it; it stays pending, to be looked at another time. A save already on its way still goes through.
export type AnalyzeReferenceRun = {
  run(reference: StyleReference, asset: AssetView): Promise<void>;
  progress: Record<string, ReferenceProgress>;
  cancel(id: string): void;
};

// onDone: the reference as the server now has it, ready or failed. onError: neither its facts nor its failure could be
// saved (the server couldn't be reached), with the words to show. deps: tests pass fakes; without them the page's own
// are made from its media. listen: whether to hear what is said (default true).
export type AnalyzeReferenceOptions = {
  onDone?: (reference: StyleReference) => void;
  onError?: (reference: StyleReference, message: string) => void;
  deps?: AnalyzeDeps;
  listen?: boolean;
};

type Job = { controller: AbortController; promise: Promise<void>; resolve: () => void };

// The words to show for a save that didn't go through. The style client throws a plain Error holding the server's
// refusal (written for people) or its own words; anything else, such as the TypeError of a server that couldn't be
// reached ("Failed to fetch"), gets the fallback.
const wordsOf = (error: unknown, fallback: string) => (error instanceof Error && error.name === "Error" && error.message ? error.message : fallback);

// The queue of video references to look over, for the Style page. Leaving the page stops the one being looked at and
// drops the rest; they stay pending. What is found is saved with saveAnalysis; a video that couldn't be looked over is
// marked failed (failAnalysis) with why in the person's words.
export function useAnalyzeReference(options: AnalyzeReferenceOptions = {}): AnalyzeReferenceRun {
  const media = useMedia();
  const { deps: given, onDone, onError, listen } = options;
  const deps = useMemo(() => given ?? browserAnalyzeDeps(media), [given, media]);
  const latest = useRef({ deps, onDone, onError, listen });
  useEffect(() => {
    latest.current = { deps, onDone, onError, listen };
  });

  const [progress, setProgress] = useState<Record<string, ReferenceProgress>>({});
  const jobs = useRef(new Map<string, Job>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    const queued = jobs.current;
    return () => {
      gone.current = true;
      for (const job of queued.values()) {
        job.controller.abort();
        job.resolve();
      }
      queued.clear();
    };
  }, []);

  // Shows where a reference has got to, or takes it off (null).
  const show = useCallback((id: string, next: ReferenceProgress | null) => {
    if (gone.current) return;
    setProgress((now) => {
      if (next === null) {
        if (!(id in now)) return now;
        const rest = { ...now };
        delete rest[id];
        return rest;
      }
      const was = now[id];
      return was && was.stage === next.stage && was.done === next.done ? now : { ...now, [id]: next };
    });
  }, []);

  // Looks one reference over and saves what was found, or why it failed. Never throws.
  const work = useCallback(
    async (reference: StyleReference, asset: AssetView, job: Job) => {
      const { signal } = job.controller;
      const mine = () => !gone.current && jobs.current.get(reference.id) === job;
      if (signal.aborted) return;
      const { deps: using, listen: hear } = latest.current;
      show(reference.id, { stage: "shots", done: 0 });
      const onProgress = (p: ReferenceProgress) => {
        if (mine()) show(reference.id, p);
      };
      let saving: Promise<StyleReference>;
      let unsaved: string; // what the person is told if nothing reaches the server
      try {
        const found = await analyzeVideo(asset, using, { signal, listen: hear, onProgress });
        if (signal.aborted) return;
        show(reference.id, { stage: "saving", done: 0 });
        // The server may refuse what was found (a strip too big, numbers that don't check): it is then marked failed
        // with the server's words, which say to try again. A save that didn't arrive is marked failed with the page's.
        unsaved = STYLE_WORDS.analysisNotSaved;
        saving = saveAnalysis(reference.id, found.analysis, found.sheet).catch((error: unknown) => failAnalysis(reference.id, wordsOf(error, unsaved)));
      } catch (error) {
        if (signal.aborted) return;
        show(reference.id, { stage: "saving", done: 0 });
        unsaved = failureReason(error);
        saving = failAnalysis(reference.id, unsaved);
      }
      // A save that has started goes through even if the reference is canceled meanwhile, so the page still hears the
      // server's answer; only leaving the page stops that.
      try {
        const answer = await saving;
        if (!gone.current) latest.current.onDone?.(answer);
      } catch (error) {
        if (!gone.current) latest.current.onError?.(reference, wordsOf(error, unsaved));
      }
    },
    [show],
  );

  const run = useCallback(
    (reference: StyleReference, asset: AssetView): Promise<void> => {
      const known = jobs.current.get(reference.id);
      if (known) return known.promise;
      if (gone.current) return Promise.resolve();
      let resolve!: () => void;
      const promise = new Promise<void>((settle) => (resolve = settle));
      const job: Job = { controller: new AbortController(), promise, resolve };
      jobs.current.set(reference.id, job);
      show(reference.id, { stage: "waiting", done: 0 });
      chain.current = chain.current
        .then(() => work(reference, asset, job))
        .catch(() => undefined)
        .finally(() => {
          if (jobs.current.get(reference.id) === job) {
            jobs.current.delete(reference.id);
            show(reference.id, null);
          }
          resolve();
        });
      return promise;
    },
    [show, work],
  );

  const cancel = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      jobs.current.delete(id);
      job.controller.abort();
      show(id, null);
      job.resolve();
    },
    [show],
  );

  return useMemo(() => ({ run, progress, cancel }), [run, progress, cancel]);
}
