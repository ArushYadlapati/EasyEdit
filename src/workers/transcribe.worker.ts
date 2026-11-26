// Hears one media file's speech: decodes its first sound track with Mediabunny, takes it to mono 16 kHz, cuts it at
// pauses and runs Whisper (transformers.js, WASM) on each window, with word times. It makes no network request but for
// the model files (Hugging Face, or NEXT_PUBLIC_SPEECH_MODEL_HOST) and the ONNX runtime, which the app serves from
// /ort/ (scripts/copy-ort.mjs). How it cuts and corrects was measured on test speech; the pure parts are in
// src/lib/captions/speech, with what was measured beside each.
import { env, pipeline, type AutomaticSpeechRecognitionOutput, type ProgressInfo } from "@huggingface/transformers";
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import { SAMPLE_RATE, createSpeechSound, silenceCutWindows } from "@/lib/captions/speech/audio";
import { correctWords, dropNonSpeech, type RawWord } from "@/lib/captions/speech/correct";
import {
  SPEECH_MODEL,
  SPEECH_MODEL_REVISION,
  pinnedModelUrl,
  type FromTranscriber,
  type ToTranscriber,
  type TranscribeFailure,
} from "@/lib/captions/speech/protocol";
import { LIMITS } from "@/lib/limits";

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";
const modelHost = process.env.NEXT_PUBLIC_SPEECH_MODEL_HOST;
if (modelHost) env.remoteHost = modelHost;
// Every request the library makes for the model goes to the pinned revision, also the ones it makes at "main".
env.fetch = (input: string | URL, init?: RequestInit) => fetch(pinnedModelUrl(input), init);

const post = (message: FromTranscriber) => self.postMessage(message);

// A way this file cannot be heard, with what to tell the page.
class Failure extends Error {
  constructor(
    readonly code: TranscribeFailure,
    detail: string,
  ) {
    super(detail);
  }
}

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The whole first sound track as mono 16 kHz from file time 0. The file's own rate is never held whole: each packet
// is resampled as it comes and closed.
async function hear(file: Blob): Promise<Float32Array> {
  // A read-ahead that fails while nothing waits for it is dropped: the read that needs those bytes fails through its reader.
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file, { handleUnhandledError: () => {} }) });
  try {
    const track = await input.getPrimaryAudioTrack().catch((error: unknown) => {
      throw new Failure("undecodable", detailOf(error));
    });
    if (!track) throw new Failure("no-sound", "The file has no sound track.");
    if (!(await track.canDecode())) throw new Failure("undecodable", "This browser cannot decode the file's sound.");
    const duration = await track.computeDuration();
    if (duration > LIMITS.captionAudioMinutes * 60) {
      throw new Failure("too-long", `The sound is ${Math.round(duration / 60)} minutes long; the most is ${LIMITS.captionAudioMinutes}.`);
    }

    const sound = createSpeechSound(Math.ceil(duration * SAMPLE_RATE));
    post({ type: "progress", stage: "sound", done: 0, total: duration });
    let reported = 0;
    try {
      for await (const sample of new AudioSampleSink(track).samples()) {
        try {
          sound.add(sample);
        } finally {
          sample.close();
        }
        // About once a second of the file, not once a packet.
        const done = Math.min(duration, sound.seconds());
        if (done - reported >= 1) {
          reported = done;
          post({ type: "progress", stage: "sound", done, total: duration });
        }
      }
    } catch (error) {
      throw new Failure("undecodable", detailOf(error));
    }
    const audio = sound.finish();
    if (audio.length === 0) throw new Failure("no-sound", "The file's sound track is empty.");
    post({ type: "progress", stage: "sound", done: duration, total: duration });
    return audio;
  } finally {
    input.dispose();
  }
}

async function loadModel() {
  try {
    return await pipeline("automatic-speech-recognition", SPEECH_MODEL, {
      revision: SPEECH_MODEL_REVISION,
      device: "wasm",
      dtype: "q8",
      // The library sums the bytes of every file it is loading into one "progress_total".
      progress_callback: (info: ProgressInfo) => {
        if (info.status === "progress_total") post({ type: "progress", stage: "model", done: info.loaded, total: info.total });
      },
    });
  } catch (error) {
    throw new Failure("model", detailOf(error));
  }
}

// The shortest window worth hearing, in seconds.
const MIN_WINDOW_SECONDS = 0.1;

async function transcribe(file: Blob, language: string, translate: boolean): Promise<FromTranscriber> {
  const audio = await hear(file);
  const seconds = audio.length / SAMPLE_RATE;
  const transcriber = await loadModel();
  try {
    const raw: RawWord[] = [];
    post({ type: "progress", stage: "speech", done: 0, total: seconds });
    // Each window on its own, not the library's 30-second chunk merging, which repeated a sentence and put times out
    // of order when it was tried on test speech.
    for (const window of silenceCutWindows(audio)) {
      // Too short to hold a word: Whisper would only make one up.
      if (window.end - window.start >= MIN_WINDOW_SECONDS) {
        const slice = audio.subarray(Math.round(window.start * SAMPLE_RATE), Math.round(window.end * SAMPLE_RATE));
        const output = (await transcriber(slice, {
          return_timestamps: "word",
          language,
          task: translate ? "translate" : "transcribe",
        })) as AutomaticSpeechRecognitionOutput;
        const words = (output.chunks ?? []).map(({ text, timestamp: [start, end] }) => ({
          text,
          start: start === null ? null : start + window.start,
          end: end === null ? null : end + window.start,
        }));
        raw.push(...dropNonSpeech(words));
      }
      post({ type: "progress", stage: "speech", done: window.end, total: seconds });
    }
    return { type: "done", words: correctWords(raw, seconds), seconds };
  } finally {
    await transcriber.dispose();
  }
}

const failed = (error: unknown): FromTranscriber =>
  error instanceof Failure
    ? { type: "failed", code: error.code, detail: error.message }
    : { type: "failed", code: "unknown", detail: detailOf(error) };

let started = false;
self.addEventListener("message", (event: MessageEvent<ToTranscriber>) => {
  if (started || event.data?.type !== "start") return; // one file per worker
  started = true;
  const { file, language = "english", translate = false } = event.data;
  void transcribe(file, language, translate && language !== "english").then(post, (error: unknown) => post(failed(error)));
});
self.addEventListener("unhandledrejection", (event) => post(failed(event.reason)));
