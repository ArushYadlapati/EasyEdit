// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { MEASURE_RATE } from "@/lib/audio/decode";
import { MESSAGES } from "@/lib/editor/messages";
import { findClip } from "@/lib/editor/store";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen, waitFor } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { openEverySection } from "../helpers/folds";

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

afterEach(() => vi.unstubAllGlobals());

// The sample project with a song m1 on the audio track. Asset "a" is the videos' file, "song" the song's.
function soundDoc(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[3].clips = [video("m1", 0, 90, { type: "audio", assetId: "song" })];
  change(d);
  return d;
}
const song = () => assetView({ id: "song", kind: "audio", name: "theme", originalFileId: "orig-song", previewStatus: "none", previewFileId: null, posterFileId: null });

function show(opts: { doc?: TimelineDoc; canEdit?: boolean; media?: MediaServices; select: string[] }) {
  const store = makeStore({ doc: opts.doc ?? soundDoc(), canEdit: opts.canEdit ?? true });
  store.getState().select(opts.select);
  const media = opts.media ?? pretendMediaServices([assetView(), song()]);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={media}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  const clip = (id: string) => findClip(store.getState().doc, id)!.clip as MediaClip;
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  return { store, clip, field, notices: noticesOf(store) };
}

it("shows a video's sound: its volume, its fades, and the two buttons", () => {
  const { field } = show({ select: ["c1"] });
  expect(screen.getByRole("heading", { name: "Sound" })).toBeTruthy();
  expect(field("Volume").value).toBe("100"); // the unit sits beside the box
  expect(screen.getByText("As recorded")).toBeTruthy();
  expect([field("Fade in").value, field("Fade out").value]).toEqual(["0", "0"]);
  expect(screen.getByRole("button", { name: "Level volume" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Separate audio" })).toBeTruthy();
});

it("turns a clip up past 100%, says how far that is, and stops at 400%", () => {
  const { store, clip, field } = show({ select: ["c1"] });
  fireEvent.change(field("Volume"), { target: { value: "200" } });
  fireEvent.blur(field("Volume"));
  expect(clip("c1").volume).toBe(2);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "volume change", ops: [{ op: "update_clip", clipId: "c1", patch: { volume: 2 } }] });
  expect(screen.getByText("+6.0 dB")).toBeTruthy();
  fireEvent.change(field("Volume"), { target: { value: "900" } });
  fireEvent.blur(field("Volume"));
  expect(clip("c1").volume).toBe(4);
  fireEvent.change(field("Volume"), { target: { value: "0" } });
  fireEvent.blur(field("Volume"));
  expect(clip("c1").volume).toBe(0);
  expect(screen.getByText("silent")).toBeTruthy();
});

it("sets fades in seconds, as whole frames no longer than the clip", () => {
  const { store, clip, field } = show({ select: ["c1"] }); // c1 is 30 frames at 30 fps
  fireEvent.change(field("Fade in"), { target: { value: "0.5" } });
  fireEvent.blur(field("Fade in"));
  expect(clip("c1").fadeIn).toBe(15);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "fade change" });
  fireEvent.change(field("Fade out"), { target: { value: "9" } });
  fireEvent.blur(field("Fade out"));
  expect(clip("c1").fadeOut).toBe(30);
  expect(field("Fade out").value).toBe("1");
});

it("separates a video's audio, and offers that only where there is sound to take", () => {
  const { store, clip } = show({ select: ["c1"] });
  fireEvent.click(screen.getByRole("button", { name: "Separate audio" }));
  expect(clip("c1").volume).toBe(0);
  const [made] = store.getState().selection.clipIds;
  expect(findClip(store.getState().doc, made)!.clip).toMatchObject({ type: "audio", assetId: "a", start: 0, duration: 30 });
});

it("an audio clip has the sound controls without Separate audio, and a text clip has none", () => {
  show({ select: ["m1"] });
  expect(screen.getByLabelText("Volume")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Separate audio" })).toBeNull();
});

it("a text clip has no Sound section", () => {
  show({ select: ["x1"] });
  expect(screen.queryByRole("heading", { name: "Sound" })).toBeNull();
});

it("says so when a video's file has no sound", () => {
  show({ select: ["c1"], media: pretendMediaServices([assetView({ hasAudio: false })]) });
  expect(screen.getByText("This file has no sound.")).toBeTruthy();
  expect(screen.queryByLabelText("Volume")).toBeNull();
});

it("a muted video cannot be separated, and a viewer changes nothing", () => {
  show({ select: ["c1"], doc: soundDoc((d) => ((d.tracks[0].clips[0] as MediaClip).volume = 0)) });
  expect((screen.getByRole("button", { name: "Separate audio" }) as HTMLButtonElement).disabled).toBe(true);
});

it("a viewer sees the sound but cannot change it", () => {
  const { field } = show({ select: ["c1"], canEdit: false });
  expect(field("Volume").disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Level volume" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Separate audio" }) as HTMLButtonElement).disabled).toBe(true);
});

// A browser that decodes any file to this sound, at the rate asked for.
function pretendDecoder(sides: (fileBytes: number) => Float32Array[]) {
  const decoded: number[] = [];
  class Offline {
    sampleRate: number;
    constructor(_channels: number, _length: number, sampleRate: number) {
      this.sampleRate = sampleRate;
    }
    async decodeAudioData(data: ArrayBuffer) {
      decoded.push(data.byteLength);
      const channels = sides(data.byteLength);
      return { numberOfChannels: channels.length, sampleRate: this.sampleRate, getChannelData: (i: number) => channels[i] };
    }
  }
  vi.stubGlobal("OfflineAudioContext", Offline);
  return decoded;
}
const tone = (seconds: number, amplitude: number) =>
  Float32Array.from({ length: Math.round(seconds * MEASURE_RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / MEASURE_RATE));
// Media services whose files can be read: each file is a blob as many bytes long as given.
function readable(bytes: Record<string, number>, assets = [assetView(), song()]): MediaServices {
  const services = pretendMediaServices(assets);
  return {
    ...services,
    files: {
      get: async (fileId) => (fileId in bytes ? { ok: true, blob: new Blob([new Uint8Array(bytes[fileId])]) } : { ok: false, problem: "missing" as never }),
      put: async () => {},
    },
  };
}

it("Level volume listens to the clip and turns a quiet one up to the common level", async () => {
  pretendDecoder(() => [tone(3, 0.05)]); // a quiet recording: about -29 dB
  const { store, clip, notices } = show({ select: ["c1"], media: readable({ "prev-a": 10 }) });
  fireEvent.click(screen.getByRole("button", { name: "Level volume" }));
  expect(screen.getByRole("button", { name: "Listening…" })).toBeTruthy();
  await waitFor(() => expect(clip("c1").volume).not.toBe(1));
  expect(clip("c1").volume).toBeCloseTo(2.83, 1); // +9 dB brings it to -20
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "level volume" });
  expect(notices).toEqual([MESSAGES.leveled(1)]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Level volume" })).toBeTruthy());
});

it("Level volume on several clips makes them equally loud, reading each file once", async () => {
  // The videos' file is quiet and the song's loud; the files are told apart by their size.
  const decoded = pretendDecoder((bytes) => [tone(4, bytes === 10 ? 0.05 : 0.9)]);
  const { store, clip, notices } = show({ select: ["c1", "c2", "m1"], media: readable({ "prev-a": 10, "orig-song": 20 }) });
  expect(screen.getByText("3 clips selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Level volume" }));
  await waitFor(() => expect(notices).toEqual([MESSAGES.leveled(3)]));
  expect(clip("c1").volume).toBeCloseTo(2.83, 1);
  expect(clip("c2").volume).toBeCloseTo(2.83, 1);
  expect(clip("m1").volume).toBeCloseTo(0.16, 1); // a loud song comes down
  expect(decoded).toEqual([10, 20]); // c1 and c2 share a file
  expect(store.getState().queue.filter((e) => e.label === "level volume")).toHaveLength(1); // one change, one undo
});

it("Level volume says when there is nothing to hear, nothing to change, or no file to read", async () => {
  pretendDecoder(() => [new Float32Array(MEASURE_RATE * 3)]);
  const silent = show({ select: ["c1"], media: readable({ "prev-a": 10 }) });
  fireEvent.click(screen.getByRole("button", { name: "Level volume" }));
  await waitFor(() => expect(silent.notices).toEqual([MESSAGES.levelSilent]));
  expect(silent.store.getState().queue).toEqual([]);
});

it("Level volume reports a file it cannot read", async () => {
  pretendDecoder(() => [tone(3, 0.05)]);
  const { store, notices } = show({ select: ["c1"], media: readable({}) });
  fireEvent.click(screen.getByRole("button", { name: "Level volume" }));
  await waitFor(() => expect(notices).toEqual([MESSAGES.levelUnreadable]));
  expect(store.getState().queue).toEqual([]);
});

it("Level volume leaves a clip that is already level", async () => {
  pretendDecoder(() => [tone(3, 0.1414)]); // -20 dB already
  const { store, notices } = show({ select: ["c1"], media: readable({ "prev-a": 10 }) });
  fireEvent.click(screen.getByRole("button", { name: "Level volume" }));
  await waitFor(() => expect(notices).toEqual([MESSAGES.alreadyLevel(1)]));
  expect(store.getState().queue).toEqual([]);
});

it("several clips with at most one that sounds offer no leveling", () => {
  show({ select: ["c1", "x1"] });
  expect(screen.getByText("2 clips selected")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Level volume" })).toBeNull();
  act(() => {});
});

it("Clean up voice sets a clip's sound for a voice in one change, and Reset takes it off again", () => {
  const { store, clip, field, notices } = show({ select: ["c1"] });
  expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  expect(screen.getByRole("switch", { name: "Cut rumble" }).getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Clean up voice" }));
  expect(clip("c1").sound).toEqual({ lowCut: true, gate: 0.25, bass: 0, mid: 3, treble: 1, compress: 0.5, denoise: 0.4 });
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "sound clean-up" });
  expect(notices).toContain(MESSAGES.cleanedUp(1));
  expect(screen.getByRole("switch", { name: "Cut rumble" }).getAttribute("aria-checked")).toBe("true");
  expect([field("Noise gate").value, field("Compressor").value, field("Bass").value, field("Presence").value, field("Treble").value]).toEqual(["25", "50", "0", "3", "1"]);
  // Pressed again there is nothing to change.
  const sent = store.getState().queue.length;
  fireEvent.click(screen.getByRole("button", { name: "Clean up voice" }));
  expect(store.getState().queue.length).toBe(sent);
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(clip("c1").sound).toEqual({ lowCut: false, gate: 0, bass: 0, mid: 0, treble: 0, compress: 0, denoise: 0 });
  expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  // One undo brings the whole clean-up back.
  store.getState().undo();
  expect(clip("c1").sound?.compress).toBe(0.5);
});

it("sets each part of the clean-up on its own, within its range", () => {
  const { store, clip, field } = show({ select: ["m1"] });
  fireEvent.click(screen.getByRole("switch", { name: "Cut rumble" }));
  expect(clip("m1").sound).toEqual({ lowCut: true });
  const type = (name: string, value: string) => {
    fireEvent.change(field(name), { target: { value } });
    fireEvent.blur(field(name));
  };
  type("Noise gate", "40");
  type("Compressor", "250");
  type("Bass", "-3.5");
  type("Presence", "20");
  type("Treble", "-40");
  expect(clip("m1").sound).toEqual({ lowCut: true, gate: 0.4, compress: 1, bass: -3.5, mid: 12, treble: -12 });
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "sound clean-up", ops: [{ op: "update_clip", clipId: "m1", patch: { sound: { treble: -12 } } }] });
  fireEvent.click(screen.getByRole("switch", { name: "Cut rumble" }));
  expect(clip("m1").sound?.lowCut).toBe(false);
});

it("cleans up every selected clip that sounds at once, and leaves a viewer's controls off", () => {
  const { clip } = show({ select: ["c1", "m1", "x1"] });
  fireEvent.click(screen.getByRole("button", { name: "Clean up voice" }));
  expect([clip("c1").sound?.lowCut, clip("m1").sound?.lowCut]).toEqual([true, true]);
});

it("a viewer sees the clean-up and cannot change it", () => {
  show({ select: ["c1"], canEdit: false, doc: soundDoc((d) => void ((d.tracks[0].clips[0] as MediaClip).sound = { lowCut: true, mid: 2 })) });
  expect((screen.getByRole("button", { name: "Clean up voice" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("switch", { name: "Cut rumble" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Presence") as HTMLInputElement).value).toBe("2");
});

// What happened in the room, at the measuring rate: bursts of noise at uneven moments, the same on every run.
function room(seconds: number, seed = 5): Float32Array {
  let s = seed;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(seconds * MEASURE_RATE);
  for (let at = 0; at < out.length; ) {
    at += Math.floor((0.1 + next() * 0.6) * MEASURE_RATE);
    const length = Math.floor((0.03 + next() * 0.15) * MEASURE_RATE);
    for (let i = at; i < Math.min(out.length, at + length); i++) out[i] = next() * 2 - 1;
    at += length;
  }
  return out;
}
// A camera's video c1 at 2 s on the timeline and a microphone's recording m1 at 1 s, six and eight seconds long.
const takeDoc = (c1Start = 60, m1Start = 30) =>
  soundDoc((d) => {
    d.tracks[0].clips = [video("c1", c1Start, 180)];
    d.tracks[3].clips = [video("m1", m1Start, 240, { type: "audio", assetId: "song" })];
  });
// The camera started two seconds into the take and the microphone at its start; the files are told apart by size.
const sameTake = () => {
  const take = room(12);
  return pretendDecoder((bytes) => [bytes === 10 ? take.slice(2 * MEASURE_RATE) : take.map((v) => v * 0.3)]);
};

it("Sync by sound moves the microphone's clip to where its sound lines up with the video's, as one change", async () => {
  sameTake();
  const { store, clip, notices } = show({ doc: takeDoc(), select: ["c1", "m1"], media: readable({ "prev-a": 10, "orig-song": 20 }) });
  fireEvent.click(screen.getByRole("button", { name: "Sync by sound" }));
  expect(screen.getByRole("button", { name: "Listening…" })).toBeTruthy();
  await waitFor(() => expect(notices).toEqual(["Moved 1 clip to line up by sound."]));
  // The video shows the take from 2 s on at 2 s of the timeline, so the take's start belongs at 0.
  expect([clip("m1").start, clip("m1").in, clip("c1").start]).toEqual([0, 0, 60]);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "sync by sound", ops: [{ op: "move_clip", clipId: "m1", start: 0 }] });
  // Asked again, there is nothing to move.
  await waitFor(() => expect(screen.getByRole("button", { name: "Sync by sound" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Sync by sound" }));
  await waitFor(() => expect(notices.at(-1)).toBe(MESSAGES.alreadySynced));
});

it("Sync by sound keeps what fits when the clip belongs before the timeline's start", async () => {
  sameTake();
  const { clip, notices } = show({ doc: takeDoc(0, 30), select: ["c1", "m1"], media: readable({ "prev-a": 10, "orig-song": 20 }) });
  fireEvent.click(screen.getByRole("button", { name: "Sync by sound" }));
  await waitFor(() => expect(notices).toEqual(["Moved 1 clip to line up by sound."]));
  // The microphone's first two seconds are from before the video begins: they are trimmed off.
  expect(clip("m1")).toMatchObject({ start: 0, in: 60, duration: 180 });
});

it("Sync by sound says when the clips are not of the same moment, or the sound cannot be read", async () => {
  const take = room(12);
  const other = room(12, 77);
  pretendDecoder((bytes) => [bytes === 10 ? take : other]);
  const different = show({ doc: takeDoc(), select: ["c1", "m1"], media: readable({ "prev-a": 10, "orig-song": 20 }) });
  fireEvent.click(screen.getByRole("button", { name: "Sync by sound" }));
  await waitFor(() => expect(different.notices).toEqual([MESSAGES.syncNoMatch]));
  expect(different.clip("m1").start).toBe(30);
  cleanup();
  const unread = show({ doc: takeDoc(), select: ["c1", "m1"], media: readable({ "orig-song": 20 }) });
  fireEvent.click(screen.getByRole("button", { name: "Sync by sound" }));
  await waitFor(() => expect(unread.notices).toEqual([MESSAGES.syncUnreadable]));
});

it("Sync by sound is offered for two sounding clips, and off for someone who can't edit", () => {
  show({ doc: takeDoc(), select: ["c1", "m1"], canEdit: false });
  expect((screen.getByRole("button", { name: "Sync by sound" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  show({ doc: takeDoc(), select: ["c1", "x1"] });
  expect(screen.queryByRole("button", { name: "Sync by sound" })).toBeNull();
});

it("Noise reduction is set in percent, says what it is for once it is on, and is part of Clean up voice", () => {
  const { store, clip, field } = show({ select: ["c1"] });
  expect(field("Noise reduction").value).toBe("0");
  expect(screen.queryByText(/Turns down steady noise/)).toBeNull();
  fireEvent.change(field("Noise reduction"), { target: { value: "60" } });
  fireEvent.blur(field("Noise reduction"));
  expect(clip("c1").sound).toEqual({ denoise: 0.6 });
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "sound clean-up", ops: [{ op: "update_clip", clipId: "c1", patch: { sound: { denoise: 0.6 } } }] });
  expect(screen.getByText(/Turns down steady noise: hiss, a fan, a hum\. Made for a voice/)).toBeTruthy();
  fireEvent.change(field("Noise reduction"), { target: { value: "250" } });
  fireEvent.blur(field("Noise reduction"));
  expect(clip("c1").sound?.denoise).toBe(1);
  act(() => store.getState().undo());
  act(() => store.getState().undo());
  expect(clip("c1").sound?.denoise ?? 0).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Clean up voice" }));
  expect([clip("c1").sound?.denoise, field("Noise reduction").value]).toEqual([0.4, "40"]);
});
