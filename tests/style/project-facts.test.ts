import { describe, expect, it } from "vitest";
import { projectFacts, type AssetKinds } from "@/lib/style/project-facts";
import { suggestStyle } from "@/lib/style/suggest";
import { ProjectAnalysis } from "@/lib/style/types";
import {
  DEFAULT_TRANSFORM,
  LOOKS,
  applyOps,
  createEmptyDoc,
  defaultCaptionStyle,
  lookPatch,
  type Clip,
  type NestClip,
  type TimelineDoc,
  type Track,
} from "@/lib/timeline";

// Clips as a project stores them, at 30 fps: every field a clip must have, plus what a test gives.
const media = (type: "video" | "image" | "audio", id: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  ({ id, type, assetId: type === "audio" ? "song" : "cam", start, duration, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...extra }) as Clip;
const video = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) => media("video", id, start, duration, extra);
const audio = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) => media("audio", id, start, duration, extra);
const text = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: "text",
    start,
    duration,
    text: "hi",
    transform: { ...DEFAULT_TRANSFORM },
    style: { fontFamily: "Geist", fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center" },
    ...extra,
  }) as Clip;
const track = (id: string, kind: Track["kind"], clips: Clip[], extra: Partial<Track> = {}): Track => ({
  id,
  kind,
  name: id,
  muted: false,
  hidden: false,
  locked: false,
  clips,
  ...extra,
});

// A 9:16 project (1080 × 1920 at 30 fps) with these tracks.
function project(...tracks: Track[]): TimelineDoc {
  return { ...createEmptyDoc("short_9x16"), tracks };
}

const KINDS: AssetKinds = { cam: "video", song: "audio", beat: "audio", photo: "image" };
const NO_TRANSITIONS = { fade: 0, crossfade: 0, slide: 0, zoom: 0, whip: 0, dip: 0 };

// The facts, checked against what a reference may keep.
function facts(doc: TimelineDoc, kinds: AssetKinds = KINDS): ProjectAnalysis {
  const found = projectFacts(doc, kinds);
  expect(ProjectAnalysis.parse(found)).toEqual(found);
  return found;
}

describe("a past project's facts", () => {
  it("are all nothing for an empty project", () => {
    expect(facts(createEmptyDoc("long_16x9"))).toEqual({
      kind: "project",
      seconds: 0,
      format: "long_16x9",
      fps: 30,
      shots: { count: 0, averageSeconds: 0, medianSeconds: 0, firstSeconds: 0, perMinute: 0, transitions: NO_TRANSITIONS },
      text: { clips: 0, perMinute: 0, fonts: [], averageWords: 0, sizes: { small: 0, medium: 0, large: 0 } },
      captions: null,
      transitions: NO_TRANSITIONS,
      textAnimations: {},
      music: null,
      speedChanges: 0,
      looks: {},
      effects: [],
    });
  });

  it("count the shots on the first video track: videos, pictures and nests, not empty slots or adjustment layers", () => {
    const slot = { id: "s", type: "placeholder", accepts: "visual", slot: { name: "Clip" }, start: 240, duration: 60, transform: { ...DEFAULT_TRANSFORM } } as unknown as Clip;
    const layer = { id: "fx", type: "adjustment", start: 0, duration: 300, transform: { ...DEFAULT_TRANSFORM } } as Clip;
    const doc = project(
      track("v1", "video", [video("c3", 150, 90), video("c1", 0, 60), media("image", "c2", 60, 90, { assetId: "photo" }), slot]),
      track("v2", "video", [video("x", 0, 15), video("y", 15, 15)]),
      track("o1", "overlay", [video("b", 30, 30), layer]),
    );
    const found = facts(doc);
    expect(found.seconds).toBe(10); // the slot ends at frame 300
    // 2 s, 3 s and 3 s, in the order they play.
    expect(found.shots).toEqual({ count: 3, averageSeconds: 2.7, medianSeconds: 3, firstSeconds: 2, perMinute: 18, transitions: NO_TRANSITIONS });
  });

  it("keep the format and frame rate, and round seconds to 0.1", () => {
    const doc = { ...createEmptyDoc("custom", { width: 1000, height: 1000 }, 24), tracks: [track("v1", "video", [video("a", 0, 100)])] };
    expect(facts(doc)).toMatchObject({ format: "custom", fps: 24, seconds: 4.2, shots: { count: 1, averageSeconds: 4.2 } });
  });

  it("measure on-screen text: how much, the fonts, the words and the sizes", () => {
    // Sizes are shares of the 1920 px height: small under 67.2 px, medium under 115.2, large from there.
    const doc = project(
      track("v1", "video", [video("a", 0, 1800)]), // 60 s
      track("t1", "text", [
        text("t1", 0, 30, { text: "Big title here", style: { fontFamily: "Inter", fontSize: 120, fontWeight: 800, color: "#fff", align: "center" } }),
        text("t2", 30, 30, { text: "two words" }), // 96 px: medium
        text("t3", 60, 30, { text: "scaled up", transform: { ...DEFAULT_TRANSFORM, scale: 1.5 } }), // 144 px: large
        text("t4", 90, 30, { text: "small print in the corner", style: { fontFamily: "Inter", fontSize: 40, fontWeight: 400, color: "#fff", align: "left" } }),
      ]),
    );
    // Two clips each in Inter and Geist: Inter is used first.
    expect(facts(doc).text).toEqual({ clips: 4, perMinute: 4, fonts: ["Inter", "Geist"], averageWords: 3, sizes: { small: 1, medium: 1, large: 2 } });
  });

  it("list at most six fonts, most used first", () => {
    const fonts = ["A", "B", "B", "C", "D", "E", "F", "G", "G", "G"];
    const clips = fonts.map((font, i) => text(`t${i}`, i * 30, 30, { style: { fontFamily: font, fontSize: 96, fontWeight: 700, color: "#fff", align: "center" } }));
    expect(facts(project(track("t1", "text", clips))).text.fonts).toEqual(["G", "B", "A", "C", "D", "E"]);
  });

  it("count text animations in, out and for emphasis", () => {
    const doc = project(
      track("t1", "text", [
        text("a", 0, 30, { animationIn: { preset: "pop", frames: 6 }, animationOut: { preset: "fade", frames: 6 } }),
        text("b", 30, 30, { animationIn: { preset: "pop", frames: 6 }, emphasis: { preset: "pulse" } }),
        text("c", 60, 30, { animationIn: null, animationOut: null, emphasis: null }),
      ]),
    );
    expect(facts(doc).textAnimations).toEqual({ "pop in": 2, "fade out": 1, pulse: 1 });
  });

  it("count the clips inside a nest for text, music and the rest, and the nest as one shot", () => {
    const nest: NestClip = {
      id: "n1",
      type: "nest",
      start: 60,
      duration: 120,
      in: 0,
      volume: 0.5,
      transform: { ...DEFAULT_TRANSFORM },
      transitionIn: { kind: "zoom", frames: 10 },
      tracks: [
        { id: "v1", kind: "video", name: "Video", muted: false, hidden: false, locked: false, clips: [video("a", 0, 60, { speed: 2 }), video("b", 60, 60)] as never },
        { id: "t1", kind: "text", name: "Text", muted: false, hidden: false, locked: false, clips: [text("x", 0, 30, { text: "Inside the nest" })] as never },
        { id: "a1", kind: "audio", name: "Music", muted: false, hidden: false, locked: false, volume: 0.8, clips: [audio("m", 0, 120)] as never },
      ],
    };
    const found = facts(project(track("v1", "video", [video("c1", 0, 60), nest]), track("t1", "text", [])));
    expect(found.shots).toMatchObject({ count: 2, firstSeconds: 2, medianSeconds: 3 }); // c1 2 s, the nest 4 s
    expect(found.text).toMatchObject({ clips: 1, averageWords: 3 });
    expect(found.music).toEqual({ clips: 1, averageVolume: 0.4 }); // 1 × the nested track's 0.8 × the nest's 0.5
    expect(found.speedChanges).toBe(1);
    expect(found.transitions).toEqual({ ...NO_TRANSITIONS, zoom: 1 });
    expect(found.shots.transitions).toEqual({ ...NO_TRANSITIONS, zoom: 1 }); // the cut from c1 into the nest
  });

  it("count a split nest's clips once, each in the half that plays it, and leave out what a trimmed nest doesn't play", () => {
    const nest: NestClip = {
      id: "n1",
      type: "nest",
      start: 0,
      duration: 120,
      in: 0,
      volume: 1,
      transform: { ...DEFAULT_TRANSFORM },
      tracks: [
        { id: "v1", kind: "video", name: "Video", muted: false, hidden: false, locked: false, clips: [video("a", 0, 60, { speed: 2 }), video("b", 60, 60)] as never },
        {
          id: "t1",
          kind: "text",
          name: "Text",
          muted: false,
          hidden: false,
          locked: false,
          clips: [text("x", 0, 30, { animationIn: { preset: "pop", frames: 6 } }), text("y", 90, 30)] as never,
        },
      ],
    };
    const whole = project(track("v1", "video", [nest]), track("t1", "text", []));
    const { doc: split } = applyOps(whole, [{ op: "split_clip", clipId: "n1", at: 60, newClipId: "n2" }]);
    expect(split.tracks[0].clips).toHaveLength(2); // both halves hold all four clips
    for (const doc of [whole, split]) {
      const found = facts(doc);
      expect(found.text.clips).toBe(2);
      expect(found.textAnimations).toEqual({ "pop in": 1 });
      expect(found.speedChanges).toBe(1);
    }
    // Played from frame 60 on, the nest shows only y and b.
    const trimmed = project(track("v1", "video", [{ ...nest, in: 60, duration: 60 }]), track("t1", "text", []));
    expect(facts(trimmed)).toMatchObject({ text: { clips: 1 }, textAnimations: {}, speedChanges: 0 });
  });

  it("leave out what a hidden track keeps from being seen and a muted one from being heard", () => {
    const warm = LOOKS.find((look) => look.id === "warm")!;
    const doc = project(
      track("v1", "video", [video("a", 0, 60)]),
      track("v2", "overlay", [video("b", 0, 30, { speed: 2, adjust: lookPatch(warm), transitionIn: { kind: "fade", frames: 6 } })], { hidden: true }),
      track("v3", "overlay", [video("c", 0, 30, { speed: 2 })], { hidden: true, muted: true }),
      track("t1", "text", [text("t", 0, 30)], { hidden: true }),
    );
    // b is still heard, so its speed change counts; nothing of it that has to be seen does.
    expect(facts(doc)).toMatchObject({ text: { clips: 0 }, looks: {}, transitions: NO_TRANSITIONS, speedChanges: 1 });
    // With the first video track hidden, the shots are the next one's.
    const covered = project(track("v1", "video", [video("a", 0, 300)], { hidden: true }), track("v2", "video", [video("b", 0, 60), video("c", 60, 60)]));
    expect(facts(covered).shots).toMatchObject({ count: 2, firstSeconds: 2 });
  });

  it("don't count captions on a clip inside a nest, which the editor doesn't caption", () => {
    const nest: NestClip = {
      id: "n1",
      type: "nest",
      start: 0,
      duration: 60,
      in: 0,
      volume: 1,
      transform: { ...DEFAULT_TRANSFORM },
      tracks: [{ id: "v1", kind: "video", name: "Video", muted: false, hidden: false, locked: false, clips: [video("a", 0, 60, { captions: true })] as never }],
    };
    expect(facts(project(track("v1", "video", [nest]), track("cap", "caption", []))).captions).toBeNull();
  });

  it("show the caption look only when captions show: a caption track that isn't hidden and a clip with captions on", () => {
    const captioned = (over: { trackHidden?: boolean; captions?: boolean; withTrack?: boolean } = {}) =>
      project(
        track("v1", "video", [video("a", 0, 90, { captions: over.captions ?? true })]),
        ...(over.withTrack === false ? [] : [track("cap", "caption", [], { hidden: over.trackHidden ?? false })]),
      );
    const doc = captioned();
    const look = defaultCaptionStyle(doc);
    expect(facts(doc).captions).toEqual({ look: "karaoke", uppercase: false, y: look.y });
    expect(facts(captioned({ trackHidden: true })).captions).toBeNull();
    expect(facts(captioned({ captions: false })).captions).toBeNull();
    expect(facts(captioned({ withTrack: false })).captions).toBeNull();
  });

  it("read the project's own caption style, as the editor sets it", () => {
    const base = project(track("v1", "video", [video("a", 0, 90, { captions: true })]), track("cap", "caption", []));
    const { doc } = applyOps(base, [{ op: "set_caption_style", patch: { preset: "bar", uppercase: true, y: 0.5 } }]);
    expect(facts(doc).captions).toEqual({ look: "bar", uppercase: true, y: 0.5 });
  });

  it("count transitions in and out by kind on every clip that has them", () => {
    const shape = {
      id: "sh",
      type: "shape",
      shape: "rect",
      start: 0,
      duration: 30,
      width: 100,
      height: 100,
      stroke: "#ffffff",
      strokeWidth: 4,
      dash: "solid",
      transform: { ...DEFAULT_TRANSFORM },
      transitionIn: { kind: "slide", frames: 8, direction: "up" },
    } as Clip;
    const doc = project(
      track("v1", "video", [
        video("a", 0, 60, { transitionIn: { kind: "fade", frames: 10 }, transitionOut: { kind: "whip", frames: 6 } }),
        video("b", 60, 60, { transitionIn: { kind: "crossfade", frames: 10 }, transitionOut: null }),
        video("c", 120, 60, { transitionIn: { kind: "fade", frames: 10 }, transitionOut: { kind: "dip", frames: 10, color: "#ffffff" } }),
      ]),
      track("s1", "shape", [shape]),
    );
    expect(facts(doc).transitions).toEqual({ fade: 2, crossfade: 1, slide: 1, zoom: 0, whip: 1, dip: 1 });
  });

  it("count the transitions at the cuts between shots, one for each cut, apart from those on every clip", () => {
    const fade = { kind: "fade", frames: 6 };
    const doc = project(
      track("v1", "video", [
        video("a", 0, 30, { transitionIn: fade }), // the way in to the first shot isn't between shots
        video("b", 30, 30, { transitionIn: { kind: "crossfade", frames: 6 } }),
        video("c", 60, 30, { transitionOut: { kind: "dip", frames: 6 } }),
        video("d", 90, 30, { transitionIn: { kind: "whip", frames: 6 }, transitionOut: fade }), // c → d is one cut: d's way in
        video("e", 120, 30), // d → e is d's way out; e → f is a straight cut
        video("f", 150, 30, { transitionOut: fade }), // the way out of the last shot isn't between shots either
      ]),
    );
    const found = facts(doc);
    expect(found.shots.count).toBe(6);
    expect(found.shots.transitions).toEqual({ ...NO_TRANSITIONS, crossfade: 1, whip: 1, fade: 1 });
    expect(found.transitions).toEqual({ ...NO_TRANSITIONS, fade: 3, crossfade: 1, whip: 1, dip: 1 });
  });

  it("don't count a logo or arrows fading in and out on other tracks as transitions between shots", () => {
    const fades = { transitionIn: { kind: "fade", frames: 6 }, transitionOut: { kind: "fade", frames: 6 } };
    const arrow = (id: string, start: number) =>
      ({ id, type: "shape", shape: "arrow", start, duration: 30, width: 200, height: 40, stroke: "#ffffff", strokeWidth: 6, dash: "solid", transform: { ...DEFAULT_TRANSFORM }, ...fades }) as Clip;
    const doc = project(
      track("v1", "video", Array.from({ length: 8 }, (_, i) => video(`s${i}`, i * 30, 30))), // 8 shots, straight cuts
      track("o1", "overlay", [media("image", "logo", 0, 240, { assetId: "photo", ...fades })]),
      track("s1", "shape", [arrow("a1", 30), arrow("a2", 120)]),
    );
    const found = facts(doc);
    expect(found.shots).toMatchObject({ count: 8, transitions: NO_TRANSITIONS });
    expect(found.transitions).toEqual({ ...NO_TRANSITIONS, fade: 6 });
    // Fill in from my videos says straight cuts, and names no kind.
    const style = suggestStyle([found]);
    expect(style.transitions).toBe("cuts");
    expect(style.transitionKinds).toBeUndefined();
  });

  it("leave a 9:16 project's captions where the editor puts them, which Fill in calls lower", () => {
    for (const format of ["short_9x16", "long_16x9"] as const) {
      const doc = { ...createEmptyDoc(format), tracks: [track("v1", "video", [video("a", 0, 90, { captions: true })]), track("cap", "caption", [])] };
      const found = facts(doc);
      expect(found.captions?.y).toBe(defaultCaptionStyle(doc).y);
      expect(suggestStyle([found]).captions?.position).toBe("lower");
    }
  });

  it("count music: audio clips of audio files, not a video's own sound split off, and not on a muted track", () => {
    const doc = project(
      track("v1", "video", [video("a", 0, 300)]),
      track("a1", "audio", [audio("song", 0, 150, { volume: 0.5 }), audio("sound", 0, 300, { assetId: "cam" }), audio("lost", 150, 30, { assetId: "gone" })], {
        volume: 0.6,
      }),
      track("a2", "audio", [audio("beat", 150, 150, { assetId: "beat", volume: 1 })]),
      track("a3", "audio", [audio("off", 0, 300, { assetId: "beat" })], { muted: true }),
    );
    // 0.5 × the track's 0.6 = 0.3, and 1: 0.65 on average.
    expect(facts(doc).music).toEqual({ clips: 2, averageVolume: 0.65 });
    expect(facts(project(track("a1", "audio", [audio("sound", 0, 300, { assetId: "cam" })]))).music).toBeNull();
  });

  it("count speed changes: faster, slower, backward and held", () => {
    const doc = project(
      track("v1", "video", [video("a", 0, 30, { speed: 2 }), video("b", 30, 30, { speed: 0 }), video("c", 60, 30, { speed: -1 }), video("d", 90, 30)]),
      track("a1", "audio", [audio("e", 0, 30, { speed: 0.5 })]),
    );
    expect(facts(doc).speedChanges).toBe(4);
  });

  it("count colour looks at any strength, on adjustment layers too, and leave out clips with none or colours of their own", () => {
    const warm = LOOKS.find((look) => look.id === "warm")!;
    const mono = LOOKS.find((look) => look.id === "mono")!;
    const doc = project(
      track("v1", "video", [
        video("a", 0, 30, { adjust: lookPatch(warm) }),
        video("b", 30, 30, { adjust: lookPatch(warm, 0.5) }),
        video("c", 60, 30, { adjust: { brightness: 0.123 } }),
        video("d", 90, 30, { adjust: lookPatch(null) }),
        video("e", 120, 30),
      ]),
      track("o1", "overlay", [{ id: "fx", type: "adjustment", start: 0, duration: 150, transform: { ...DEFAULT_TRANSFORM }, adjust: lookPatch(mono) } as Clip]),
    );
    expect(facts(doc).looks).toEqual({ warm: 2, mono: 1 });
  });

  it("list the effects in use, with dark edges only where they aren't part of a look", () => {
    const vintage = LOOKS.find((look) => look.id === "vintage")!;
    const doc = project(
      track("v1", "video", [
        video("a", 0, 30, { adjust: { grain: 0.4 } }),
        video("b", 30, 30, { adjust: { ...lookPatch(vintage), glitch: 0.2 } }),
        video("c", 60, 30, { adjust: { blur: 6, grain: 0 } }),
      ]),
    );
    expect(facts(doc).effects).toEqual(["grain", "glitch", "blur"]);
    const edged = project(track("v1", "video", [video("a", 0, 30, { adjust: { vignette: 0.6 } })]));
    expect(facts(edged).effects).toEqual(["vignette"]);
  });

  it("read an old project that lacks the fields added since", () => {
    const old = {
      schemaVersion: 1,
      format: "short_9x16",
      width: 1080,
      height: 1920,
      fps: 30,
      tracks: [
        { id: "v1", kind: "video", name: "Video 1", muted: false, hidden: false, locked: false, clips: [{ id: "a", type: "video", assetId: "cam", start: 0, duration: 90, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } }] },
        { id: "a1", kind: "audio", name: "Audio 1", muted: false, hidden: false, locked: false, clips: [{ id: "m", type: "audio", assetId: "song", start: 0, duration: 90, in: 0, speed: 1, volume: 0.25, transform: { ...DEFAULT_TRANSFORM } }] },
      ],
    } as unknown as TimelineDoc;
    expect(facts(old)).toMatchObject({ seconds: 3, shots: { count: 1 }, captions: null, music: { clips: 1, averageVolume: 0.25 }, transitions: NO_TRANSITIONS });
  });

  it("don't need the project's transcripts or colour tables", () => {
    const doc = project(track("v1", "video", [video("a", 0, 90, { captions: true })]), track("cap", "caption", []));
    doc.captions = { style: { ...defaultCaptionStyle(doc), preset: "word" } }; // read without transcripts
    expect(facts(doc).captions?.look).toBe("word");
  });
});
