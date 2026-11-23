import type { FxSettings } from "@/lib/audio/clean-dsp";
import { fadeFrames, fxOf, panOf, soundingClips } from "@/lib/render/clip-sound";
import type { Ease, MediaClip, TimelineDoc } from "@/lib/timeline";
import { isKeyframed } from "@/lib/timeline/keyframes";

// Where each clip sounds on the timeline, in samples, and from where in its file. Every position is worked out from
// whole sample and frame numbers each time, never by adding, so ten minutes in is as exact as the first sample.

export type Voice = {
  clipIds: string[]; // one clip, or a run of clips that continue one another, in timeline order
  fileId: string;
  start: number; // the first timeline sample
  end: number; // the sample after the last
  in: number; // the first clip's in point, in project frames
  speed: number;
  gain: number;
  fadeIn: number; // samples the voice rises over at its start, and falls over at its end; never more than it is long
  fadeOut: number;
  // The clip's volume keyframes, when it has any: `at` in samples from the voice's start (it may lie outside the
  // voice). The voice's gain is then 1 and these give its volume.
  envelope?: EnvelopePoint[];
  pan?: number; // where the voice sits between left (−1) and right (1), when it is not where it was recorded
  fx?: FxSettings; // the clip's sound clean-up, when some of it is on
};

export type EnvelopePoint = { at: number; value: number; ease?: Ease };

export type SoundSchedule = {
  fps: number;
  sampleRate: number;
  voices: Voice[]; // tracks in order, each track's clips in order
  lastBlock: Record<string, number>; // fileId → the last one-second block any voice of it reaches
};

// How much of the file a voice reads either side of what it plays, per unit of speed above 1: it covers the
// resampler's reach and the stretcher's frame, hop and search.
export const SOURCE_MARGIN_SECONDS = 0.05;

// A timeline frame's first sample, multiplied first so whole numbers stay whole. At a frame rate that does not divide
// the sample rate this rounds up, at most one sample late, the same for every clip, so cuts still meet.
function frameSample(frame: number, fps: number, sampleRate: number): number {
  return Math.ceil((frame * sampleRate) / fps);
}

// A clip that picks up exactly where the one before it on its track left off: the next frame, the same file, speed and
// volume, and the in point the first one reaches, compared exactly. A fade at the cut keeps the two apart.
function continues(clip: MediaClip, next: MediaClip, file: string, nextFile: string): boolean {
  return (
    !isKeyframed(clip, "volume") &&
    !isKeyframed(next, "volume") &&
    panOf(clip) === panOf(next) &&
    JSON.stringify(fxOf(clip)) === JSON.stringify(fxOf(next)) &&
    fadeFrames(clip).out === 0 &&
    fadeFrames(next).in === 0 &&
    next.start === clip.start + clip.duration &&
    nextFile === file &&
    next.speed === clip.speed &&
    next.volume === clip.volume &&
    next.in === clip.in + clip.duration * clip.speed
  );
}

// A length in frames as samples, to the nearest one.
function frameCount(frames: number, fps: number, sampleRate: number): number {
  return Math.round((frames * sampleRate) / fps);
}

// Every clip the export hears that has a file in `sounds` (clipId → fileId), with seamless runs merged into one voice.
export function soundSchedule(doc: TimelineDoc, sounds: Record<string, string>, fps: number, sampleRate: number): SoundSchedule {
  const voices: Voice[] = [];
  let open: { voice: Voice; track: string; last: MediaClip } | null = null;
  for (const { track, clip, gain } of soundingClips(doc)) {
    const fileId = sounds[clip.id];
    if (fileId === undefined) continue;
    const end = frameSample(clip.start + clip.duration, fps, sampleRate);
    const fade = fadeFrames(clip);
    const fadeOut = frameCount(fade.out, fps, sampleRate);
    if (open && open.track === track.id && continues(open.last, clip, open.voice.fileId, fileId)) {
      open.voice.clipIds.push(clip.id);
      open.voice.end = end;
      open.voice.fadeOut = fadeOut; // the run ends as its last clip does
      open.last = clip;
      continue;
    }
    const voice: Voice = {
      clipIds: [clip.id],
      fileId,
      start: frameSample(clip.start, fps, sampleRate),
      end,
      in: clip.in,
      speed: clip.speed,
      gain,
      fadeIn: frameCount(fade.in, fps, sampleRate),
      fadeOut,
      ...(panOf(clip) !== 0 && { pan: panOf(clip) }),
      ...(fxOf(clip) && { fx: fxOf(clip)! }),
      ...(isKeyframed(clip, "volume") && {
        envelope: clip.keyframes!.volume!.map((k) => ({ at: Math.round((k.at * sampleRate) / fps), value: k.value, ...(k.ease && { ease: k.ease }) })),
      }),
    };
    voices.push(voice);
    open = { voice, track: track.id, last: clip };
  }
  const lastBlock: Record<string, number> = {};
  for (const voice of voices) {
    const block = Math.floor((voice.end - 1) / sampleRate);
    lastBlock[voice.fileId] = Math.max(lastBlock[voice.fileId] ?? block, block);
  }
  return { fps, sampleRate, voices, lastBlock };
}

// The voice's place in its file, in frames at the decoded rate, for a timeline sample: the clip's clock made
// continuous, from whole numbers each time.
export function sourceAt(schedule: SoundSchedule, voice: Voice, sample: number, rate: number): number {
  return (rate * voice.in) / schedule.fps + ((sample - voice.start) * voice.speed * rate) / schedule.sampleRate;
}

// The seconds of the file the voice reads, with a margin either side that grows with speed, never below 0.
export function voiceWindow(schedule: SoundSchedule, voice: Voice): { from: number; to: number } {
  const margin = SOURCE_MARGIN_SECONDS * Math.max(1, voice.speed);
  return {
    from: Math.max(0, sourceAt(schedule, voice, voice.start, 1) - margin),
    to: sourceAt(schedule, voice, voice.end, 1) + margin,
  };
}
