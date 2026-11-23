import { describe, expect, it, vi } from "vitest";
import { createClipboard } from "@/lib/editor/clipboard";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { runCommand } from "@/lib/editor/run-command";
import { VOLUME_STEP, hasOwnSound, muteOps, separateAudioOps, soundClipsOf, volumeStepOps } from "@/lib/editor/sound";
import { findClip } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, text, video } from "./fixtures";

// The sample project (v1: c1 0-30, c2 30-60; t1: x1, x2; cap; a1) with a song m1 on a1, frames 0 to 90.
function soundDoc(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[3].clips = [video("m1", 0, 90, { type: "audio", assetId: "song" })];
  change(d);
  return d;
}
const withVolumes = (volumes: Record<string, number>) =>
  soundDoc((d) => {
    for (const track of d.tracks) for (const clip of track.clips) if (clip.id in volumes) (clip as MediaClip).volume = volumes[clip.id];
  });
const lock = (d: TimelineDoc, trackId: string) => {
  d.tracks.find((t) => t.id === trackId)!.locked = true;
};
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe("which clips sound", () => {
  it("counts videos and audio clips, in document order, and nothing else", () => {
    const d = soundDoc((doc) => doc.tracks[0].clips.push(video("i1", 60, 30, { type: "image" })));
    expect(soundClipsOf(d, ["m1", "x1", "i1", "c2", "c1", "gone"]).map(({ clip, track }) => [clip.id, track.id])).toEqual([["c1", "v1"], ["c2", "v1"], ["m1", "a1"]]);
    expect([hasOwnSound(video("v", 0, 1)), hasOwnSound(video("i", 0, 1, { type: "image" })), hasOwnSound(text("t", 0, 1))]).toEqual([true, false, false]);
  });
});

describe("louder and quieter", () => {
  it("moves every selected clip that sounds one step, on tenths", () => {
    expect(VOLUME_STEP).toBe(0.1);
    expect(volumeStepOps(soundDoc(), ["c1", "x1", "m1"], 1)).toEqual([
      { op: "update_clip", clipId: "c1", patch: { volume: 1.1 } },
      { op: "update_clip", clipId: "m1", patch: { volume: 1.1 } },
    ]);
    expect(volumeStepOps(soundDoc(), ["c1"], -1)).toEqual([{ op: "update_clip", clipId: "c1", patch: { volume: 0.9 } }]);
    // A volume between steps lands on the next step that way, with no rounding dust.
    expect(volumeStepOps(withVolumes({ c1: 0.34 }), ["c1"], 1)).toEqual([{ op: "update_clip", clipId: "c1", patch: { volume: 0.4 } }]);
    expect(volumeStepOps(withVolumes({ c1: 0.34 }), ["c1"], -1)).toEqual([{ op: "update_clip", clipId: "c1", patch: { volume: 0.2 } }]);
    expect(volumeStepOps(withVolumes({ c1: 0.7 }), ["c1"], 1)).toEqual([{ op: "update_clip", clipId: "c1", patch: { volume: 0.8 } }]);
  });

  it("stops at silent and at the loudest, and leaves a locked track's clips out", () => {
    expect(volumeStepOps(withVolumes({ c1: 4, m1: 3.95 }), ["c1", "m1"], 1)).toEqual([{ op: "update_clip", clipId: "m1", patch: { volume: 4 } }]);
    expect(volumeStepOps(withVolumes({ c1: 0, m1: 0.05 }), ["c1", "m1"], -1)).toEqual([{ op: "update_clip", clipId: "m1", patch: { volume: 0 } }]);
    const d = soundDoc((doc) => lock(doc, "a1"));
    expect(volumeStepOps(d, ["c1", "m1"], 1).map((op) => (op as { clipId: string }).clipId)).toEqual(["c1"]);
    expect(volumeStepOps(soundDoc(), ["x1"], 1)).toEqual([]);
  });
});

describe("mute", () => {
  it("silences what still sounds, and puts back to as recorded when all are silent", () => {
    expect(muteOps(withVolumes({ c1: 0, m1: 1.5 }), ["c1", "m1", "x1"])).toEqual([{ op: "update_clip", clipId: "m1", patch: { volume: 0 } }]);
    expect(muteOps(withVolumes({ c1: 0, m1: 0 }), ["c1", "m1"])).toEqual([
      { op: "update_clip", clipId: "c1", patch: { volume: 1 } },
      { op: "update_clip", clipId: "m1", patch: { volume: 1 } },
    ]);
    expect(muteOps(soundDoc(), ["x1"])).toEqual([]);
  });
});

describe("separating a video's audio", () => {
  it("puts the sound on an audio clip at the same moment of the same file, and silences the video", () => {
    const d = soundDoc((doc) => {
      doc.tracks[0].clips[1] = video("c2", 30, 30, { assetId: "clip-b", in: 45, speed: 2, volume: 0.6, fadeIn: 5, fadeOut: 8, captions: true });
      doc.tracks[3].clips = []; // room on a1
    });
    const out = separateAudioOps(d, ["c2"], ids());
    expect(out).toEqual({
      ok: true,
      clipIds: ["n1"],
      ops: [
        {
          op: "add_clip",
          trackId: "a1",
          clip: {
            id: "n1", type: "audio", assetId: "clip-b", start: 30, duration: 30, in: 45, speed: 2, volume: 0.6,
            transform: expect.objectContaining({ x: 0.5, y: 0.5 }), fadeIn: 5, fadeOut: 8, captions: true,
            group: "n2", // the two stay linked
          },
        },
        { op: "update_clip", clipId: "c2", patch: { volume: 0, group: "n2", fadeIn: 0, fadeOut: 0, captions: false } },
      ],
    });
  });

  it("makes a new audio track when none has room there", () => {
    const out = separateAudioOps(soundDoc(), ["c1"], ids()); // m1 fills a1 from 0 to 90
    expect(out.ok && out.ops).toMatchObject([
      { op: "add_track", track: { id: "n1", kind: "audio", name: "Audio 2" } },
      { op: "add_clip", trackId: "n1", clip: { id: "n2", type: "audio", start: 0, duration: 30 } },
      { op: "update_clip", clipId: "c1", patch: { volume: 0 } },
    ]);
    expect(out.ok && (out.ops[2] as { patch: unknown }).patch).toEqual({ volume: 0, group: "n3" }); // no fades or captions to move; the link's name
  });

  it("separates several at once, and only videos that still have sound to give", () => {
    const d = soundDoc((doc) => {
      doc.tracks[3].clips = [];
      (doc.tracks[0].clips[1] as MediaClip).volume = 0; // c2 is already silent
    });
    const out = separateAudioOps(d, ["c1", "c2", "x1"], ids());
    expect(out.ok && out.clipIds).toEqual(["n1"]);
    // A file the library says has no sound is left alone.
    expect(separateAudioOps(d, ["c1"], ids(), () => false)).toEqual({ ok: false, why: "nothing" });
    expect(separateAudioOps(d, ["x1"], ids())).toEqual({ ok: false, why: "nothing" });
    expect(separateAudioOps(soundDoc(), ["m1"], ids())).toEqual({ ok: false, why: "nothing" }); // already an audio clip
    expect(separateAudioOps(soundDoc((doc) => lock(doc, "v1")), ["c1"], ids())).toEqual({ ok: false, why: "nothing" });
  });

  it("says so when the project can take no more tracks", () => {
    const d = soundDoc((doc) => {
      while (doc.tracks.length < LIMITS.tracksPerProject) doc.tracks.push({ id: `o${doc.tracks.length}`, kind: "overlay", name: `Overlay ${doc.tracks.length}`, muted: false, hidden: false, locked: false, clips: [] });
    });
    expect(separateAudioOps(d, ["c1"], ids())).toEqual({ ok: false, why: "room" });
  });
});

describe("the sound commands", () => {
  function setup(opts: { canEdit?: boolean; doc?: TimelineDoc; hasSound?: (assetId: string) => boolean } = {}) {
    const store = makeStore({ canEdit: opts.canEdit ?? true, doc: opts.doc ?? soundDoc() });
    const ctx = { store, clipboard: createClipboard(), openShortcuts: vi.fn(), hasSound: opts.hasSound };
    return { st: () => store.getState(), ctx, notices: noticesOf(store), volume: (id: string) => (findClip(store.getState().doc, id)!.clip as MediaClip).volume };
  }

  it("turn the selection up and down as one change each", () => {
    const { st, ctx, volume } = setup();
    st().select(["c1", "m1"]);
    runCommand("volume-up", ctx);
    runCommand("volume-up", ctx);
    runCommand("volume-down", ctx);
    expect([volume("c1"), volume("m1"), volume("c2")]).toEqual([1.1, 1.1, 1]);
    expect(st().queue.map((e) => e.label)).toEqual(["volume change", "volume change", "volume change"]);
    st().undo();
    expect(volume("c1")).toBe(1.2);
  });

  it("mute and unmute the selection", () => {
    const { st, ctx, volume } = setup();
    st().select(["c1"]);
    runCommand("mute-clip", ctx);
    expect(volume("c1")).toBe(0);
    runCommand("mute-clip", ctx);
    expect(volume("c1")).toBe(1);
  });

  it("say how to use them with nothing that sounds selected, and that the track is locked", () => {
    const { st, ctx, notices } = setup({ doc: soundDoc((d) => lock(d, "a1")) });
    runCommand("volume-up", ctx);
    st().select(["x1"]);
    runCommand("mute-clip", ctx);
    st().select(["m1"]);
    runCommand("volume-down", ctx);
    expect(notices).toEqual([MESSAGES.selectSoundClip, MESSAGES.selectSoundClip, explainOpError("TRACK_LOCKED")]);
    expect(st().queue).toEqual([]);
  });

  it("separate the selected video's audio, select the new clip, and undo in one step", () => {
    const { st, ctx, volume } = setup();
    st().select(["c1"]);
    runCommand("separate-audio", ctx);
    const [newId] = st().selection.clipIds;
    expect(findClip(st().doc, newId)).toMatchObject({ clip: { type: "audio", assetId: "a", start: 0, duration: 30, volume: 1 }, track: { kind: "audio", name: "Audio 2" } });
    expect(volume("c1")).toBe(0);
    expect(st().queue.map((e) => e.label)).toEqual(["separate audio"]);
    st().undo();
    expect(volume("c1")).toBe(1);
    expect(st().doc.tracks.filter((t) => t.kind === "audio")).toHaveLength(1);
  });

  it("say what to select when there is nothing to separate", () => {
    const { st, ctx, notices } = setup({ hasSound: () => false });
    st().select(["c1"]);
    runCommand("separate-audio", ctx);
    st().select(["m1"]);
    runCommand("separate-audio", ctx);
    expect(notices).toEqual([MESSAGES.nothingToSeparate, MESSAGES.nothingToSeparate]);
    expect(st().queue).toEqual([]);
  });

  it("do nothing for a viewer", () => {
    const { st, ctx, notices } = setup({ canEdit: false });
    st().select(["c1"]);
    for (const command of ["volume-up", "volume-down", "mute-clip", "separate-audio"] as const) runCommand(command, ctx);
    expect([st().queue, notices]).toEqual([[], []]);
  });

  it("show and hide the audio meter, for a viewer too", () => {
    const { st, ctx } = setup({ canEdit: false });
    expect(st().showAudioMeter).toBe(true);
    runCommand("toggle-audio-meter", ctx);
    expect(st().showAudioMeter).toBe(false);
    runCommand("toggle-audio-meter", ctx);
    expect(st().showAudioMeter).toBe(true);
  });
});
