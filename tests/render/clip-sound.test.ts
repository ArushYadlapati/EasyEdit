import { describe, expect, it } from "vitest";
import { MAX_ELEMENT_RATE, MIN_ELEMENT_RATE, mediaWants } from "@/lib/editor/media-plan";
import { MAX_SOUND_SPEED, MIN_SOUND_SPEED, clipSound, playsInPreview, soundGain, soundingClips } from "@/lib/render/clip-sound";
import { DEFAULT_TRANSFORM, createEmptyDoc, type Clip, type Track } from "@/lib/timeline";
import { text, video } from "../editor/fixtures";

const track = (kind: Track["kind"], over: Partial<Track> = {}): Track =>
  ({ id: "t", kind, name: "T", muted: false, hidden: false, locked: false, clips: [], ...over });
const vid = (over: Record<string, unknown> = {}) => video("c", 0, 30, over);
const song = (over: Record<string, unknown> = {}) => video("m", 0, 30, { type: "audio", assetId: "song", ...over });
const invisible = { transform: { ...DEFAULT_TRANSFORM, opacity: 0 } };

describe("which clips sound, and how loud", () => {
  it("plays a video or audio clip at its volume, never louder than 1", () => {
    expect(soundGain(track("video"), vid({ volume: 0.5 }))).toBe(0.5);
    expect(soundGain(track("audio"), song({ volume: 1.5 }))).toBe(1);
    expect(soundGain(track("overlay"), vid({ volume: 2 }))).toBe(1);
    expect(clipSound(track("audio"), song({ volume: 0.3 }))).toEqual({ gain: 0.3 });
  });

  it("silences a hidden video or overlay track, but not a hidden audio track", () => {
    expect(clipSound(track("video", { hidden: true }), vid())).toBeNull();
    expect(clipSound(track("overlay", { hidden: true }), vid())).toBeNull();
    expect(clipSound(track("audio", { hidden: true }), song())).toEqual({ gain: 1 });
  });

  it("plays what the preview plays: audio anywhere, a picture only on a shown track, a muted track's video too", () => {
    expect(playsInPreview(track("overlay", { hidden: true }), video("i", 0, 30, { type: "image" }))).toBe(false);
    expect(playsInPreview(track("audio", { hidden: true }), song())).toBe(true);
    expect(playsInPreview(track("video", { muted: true }), vid())).toBe(true);
    expect(playsInPreview(track("text"), text("x", 0, 30))).toBe(false);
  });

  it("never sounds at a speed the preview's elements cannot play", () => {
    expect(MIN_SOUND_SPEED).toBeGreaterThanOrEqual(MIN_ELEMENT_RATE);
    expect(MAX_SOUND_SPEED).toBeLessThanOrEqual(MAX_ELEMENT_RATE);
  });

  it("silences every clip on a muted track", () => {
    expect(soundGain(track("video", { muted: true }), vid())).toBe(0);
    expect(clipSound(track("audio", { muted: true }), song())).toBeNull();
  });

  it("never sounds a picture or text; locked and opacity mean nothing to sound", () => {
    expect(soundGain(track("overlay"), video("i", 0, 30, { type: "image", volume: 1 }))).toBe(0);
    expect(clipSound(track("text"), text("x", 0, 30))).toBeNull();
    expect(clipSound(track("video", { locked: true }), vid())).toEqual({ gain: 1 });
    expect(clipSound(track("video"), vid(invisible))).toEqual({ gain: 1 });
  });

  it("is silent at volume 0 and outside the speeds that sound, both ends included", () => {
    expect([MIN_SOUND_SPEED, MAX_SOUND_SPEED]).toEqual([0.0625, 16]);
    expect(clipSound(track("video"), vid({ volume: 0 }))).toBeNull();
    expect(clipSound(track("video"), vid({ speed: 0.0625 }))).toEqual({ gain: 1 });
    expect(clipSound(track("video"), vid({ speed: 16 }))).toEqual({ gain: 1 });
    expect(clipSound(track("video"), vid({ speed: 0.06 }))).toBeNull();
    expect(clipSound(track("video"), vid({ speed: 16.5 }))).toBeNull();
  });

  it("lists the clips that sound in document order", () => {
    const d = createEmptyDoc("short_9x16"); // v1, t1, cap, a1
    d.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, invisible)];
    d.tracks[1].clips = [text("x1", 0, 30)];
    d.tracks[3] = { ...d.tracks[3], hidden: true, clips: [video("m1", 0, 60, { type: "audio", assetId: "song", volume: 0.5 })] };
    expect(soundingClips(d).map(({ clip, gain }) => [clip.id, gain])).toEqual([["c1", 1], ["c2", 1], ["m1", 0.5]]);
    d.tracks[0].muted = true;
    expect(soundingClips(d).map(({ clip }) => clip.id)).toEqual(["m1"]);
  });

  it("is the gain the preview plays each clip at, and sounds exactly the clips the preview sounds", () => {
    for (const hidden of [false, true]) {
      for (const muted of [false, true]) {
        const d = createEmptyDoc("short_9x16");
        d.tracks[0] = { ...d.tracks[0], hidden, muted, clips: [
          video("c1", 0, 30, { volume: 0.3 }), video("i1", 30, 30, { type: "image", assetId: "b" }), video("c2", 60, 30, { speed: 20 }),
        ] };
        d.tracks[3] = { ...d.tracks[3], hidden, muted, clips: [
          video("m1", 0, 60, { type: "audio", assetId: "song", volume: 1.5 }), video("m2", 60, 30, { type: "audio", assetId: "song", volume: 0 }),
        ] };
        for (const frame of [10, 40, 70]) {
          const wants = mediaWants(d, frame, { playing: true, rate: 1 });
          for (const want of wants) {
            const owner = d.tracks.find((t) => t.clips.some((c) => c.id === want.clipId))!;
            const clip = owner.clips.find((c) => c.id === want.clipId) as Clip;
            expect(want.volume, `${want.clipId} hidden=${hidden} muted=${muted}`).toBe(want.rate === 0 ? 0 : soundGain(owner, clip));
          }
          // and the other way: a clip under the frame sounds in the export exactly when the preview plays it aloud
          for (const owner of d.tracks) {
            for (const clip of owner.clips) {
              if (clip.type === "text" || clip.start > frame || frame >= clip.start + clip.duration) continue;
              const heard = wants.some((w) => w.clipId === clip.id && w.volume > 0);
              expect(heard, `${clip.id} at ${frame} hidden=${hidden} muted=${muted}`).toBe(clipSound(owner, clip) !== null);
            }
          }
        }
      }
    }
  });
});
