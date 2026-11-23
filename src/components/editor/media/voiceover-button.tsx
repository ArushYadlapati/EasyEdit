"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/editor/geometry";
import { VOICEOVER_MESSAGE, createVoiceover, voiceoverName, type Take } from "@/lib/editor/voiceover";
import { useEditorStore, useSettings } from "../context";
import { useMediaDrop } from "./media-context";

// The browser's part of a take: the microphone, recorded until told to stop.
async function recordMicrophone(): Promise<Take> {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("no recorder");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  try {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
    recorder.start();
    return {
      stop: () =>
        new Promise<Blob>((resolve) => {
          recorder.addEventListener("stop", () => {
            release();
            resolve(new Blob(chunks, { type: recorder.mimeType }));
          });
          recorder.stop();
        }),
      cancel() {
        if (recorder.state !== "inactive") recorder.stop();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

// What the recorder wrote, as samples. The browser's own decoder reads whatever format it recorded in.
async function decodeRecording(blob: Blob): Promise<{ sides: Float32Array[]; sampleRate: number }> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { sides: Array.from({ length: buffer.numberOfChannels }, (_, side) => buffer.getChannelData(side)), sampleRate: buffer.sampleRate };
  } finally {
    void ctx.close();
  }
}

// The clock, read when a take starts and is named: never while rendering.
const clockNow = () => Date.now();
const takeName = () => voiceoverName(new Date());

// Record voiceover: the microphone is recorded while the project plays from the playhead; Stop saves the take, uploads
// it and puts it on an audio track where the recording began. canUpload: someone who can edit, in a space with storage.
export function VoiceoverButton({ canUpload }: { canUpload: boolean }) {
  const store = useEditorStore();
  const drop = useMediaDrop();
  const stillSeconds = useSettings((s) => s.stillSeconds);
  const voiceover = useMemo(
    () =>
      createVoiceover({
        store,
        record: recordMicrophone,
        decode: decodeRecording,
        drop: (file, at) => drop?.dropFiles([file], at, { stillSeconds }),
        now: clockNow,
        name: takeName,
      }),
    [store, drop, stillSeconds],
  );
  const state = useStore(voiceover.state);
  // Leaving the panel mid-take lets the microphone go.
  useEffect(() => () => voiceover.cancel(), [voiceover]);
  if (state.stage === "recording") return <Recording key={state.startedAt} startedAt={state.startedAt} onStop={() => void voiceover.stop()} />;
  const busy = state.stage === "asking" || state.stage === "saving";
  return (
    <div className="flex flex-col gap-1">
      <Button data-edit-control className="w-full" disabled={!canUpload || !drop || busy} onClick={() => void voiceover.start()}>
        <Mic />
        {state.stage === "asking" ? "Waiting for the microphone…" : state.stage === "saving" ? "Saving the recording…" : "Record voiceover"}
      </Button>
      {state.stage === "failed" && (
        <p role="alert" className="text-[13px] leading-5 text-ed-danger">
          {VOICEOVER_MESSAGE[state.why]}
        </p>
      )}
    </div>
  );
}

// A take in progress: how long it has run, counted from the clock a few times a second, and the button that ends it.
function Recording({ startedAt, onStop }: { startedAt: number; onStop(): void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <div className="flex flex-col gap-1">
      <Button variant="danger" className="w-full" onClick={onStop}>
        <Square />
        Stop recording
      </Button>
      <p role="status" className="text-[13px] leading-5 text-ed-text tabular-nums">
        Recording… {formatClock(seconds, 1)}
      </p>
    </div>
  );
}
