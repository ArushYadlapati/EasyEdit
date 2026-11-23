import { createStore, type StoreApi } from "zustand/vanilla";
import { encodeWav } from "@/lib/audio/wav";
import type { TimelinePoint } from "./geometry";
import type { EditorStore } from "./store";

// Recording a voiceover: the microphone is recorded while the timeline plays, and when it stops the take is saved as
// a sound file, uploaded like any other, and put on an audio track where the recording began. What it needs from the
// browser is passed in, so tests pass fakes.

export type VoiceoverState =
  | { stage: "idle" }
  | { stage: "asking" } // waiting for the browser's permission to use the microphone
  | { stage: "recording"; startedAt: number; frame: number } // startedAt: the clock's time; frame: where the take will go
  | { stage: "saving" }
  | { stage: "failed"; why: VoiceoverTrouble };

export type VoiceoverTrouble = "denied" | "no-microphone" | "unsupported" | "empty" | "unreadable";

export const VOICEOVER_MESSAGE: Record<VoiceoverTrouble, string> = {
  denied: "The browser didn't allow the microphone. Allow it for this site and try again.",
  "no-microphone": "No microphone was found.",
  unsupported: "This browser can't record sound here.",
  empty: "Nothing was recorded.",
  unreadable: "The recording couldn't be read. Try again.",
};

// One take in progress: stop() ends it and gives what was recorded; cancel() ends it and gives nothing.
export type Take = { stop(): Promise<Blob>; cancel(): void };

export type VoiceoverDeps = {
  store: EditorStore;
  // Asks for the microphone and starts recording it. Rejects with a DOMException named NotAllowedError or
  // NotFoundError, or anything else for a browser that cannot record.
  record(): Promise<Take>;
  // The recording as samples: one array per channel, and their rate.
  decode(blob: Blob): Promise<{ sides: Float32Array[]; sampleRate: number }>;
  // Uploads the file and lands it at the point once it is in.
  drop(file: File, at: TimelinePoint): void;
  now(): number; // milliseconds, for the take's length as it runs
  name(): string; // the file's name, without its extension
};

export type Voiceover = {
  state: StoreApi<VoiceoverState>;
  start(): Promise<void>; // asks for the microphone, then records and plays from the playhead
  stop(): Promise<void>; // ends the take, saves it and puts it on the timeline
  cancel(): void; // ends the take and keeps nothing
};

function troubleOf(error: unknown): VoiceoverTrouble {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-microphone";
  return "unsupported";
}

export function createVoiceover(deps: VoiceoverDeps): Voiceover {
  const state = createStore<VoiceoverState>(() => ({ stage: "idle" }));
  let take: Take | null = null;

  return {
    state,
    async start() {
      const stage = state.getState().stage;
      if (stage === "asking" || stage === "recording" || stage === "saving") return;
      if (!deps.store.getState().canEdit) return;
      state.setState({ stage: "asking" }, true);
      try {
        const started = await deps.record();
        // Cancelled while the browser was asking: the microphone is let go at once.
        if (state.getState().stage !== "asking") return started.cancel();
        take = started;
      } catch (error) {
        state.setState({ stage: "failed", why: troubleOf(error) }, true);
        return;
      }
      const editor = deps.store.getState();
      state.setState({ stage: "recording", startedAt: deps.now(), frame: editor.playhead }, true);
      // The video plays while you talk over it. A project with nothing to play just records.
      editor.play();
    },
    async stop() {
      const now = state.getState();
      if (now.stage !== "recording" || !take) return;
      const ending = take;
      take = null;
      state.setState({ stage: "saving" }, true);
      deps.store.getState().pause();
      try {
        const blob = await ending.stop();
        if (blob.size === 0) return state.setState({ stage: "failed", why: "empty" }, true);
        const sound = await deps.decode(blob);
        if (sound.sides.length === 0 || sound.sides[0].length === 0) return state.setState({ stage: "failed", why: "empty" }, true);
        const file = new File([encodeWav(sound.sides, sound.sampleRate)], `${deps.name()}.wav`, { type: "audio/wav" });
        deps.drop(file, { frame: now.frame, trackId: null });
        state.setState({ stage: "idle" }, true);
      } catch {
        state.setState({ stage: "failed", why: "unreadable" }, true);
      }
    },
    cancel() {
      const stage = state.getState().stage;
      if (stage === "recording") deps.store.getState().pause();
      take?.cancel();
      take = null;
      if (stage !== "saving") state.setState({ stage: "idle" }, true);
    },
  };
}

// "Voiceover 14-05-09": a name that tells one take from the next.
export function voiceoverName(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `Voiceover ${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`;
}
