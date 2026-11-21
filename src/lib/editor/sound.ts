import { DEFAULT_TRANSFORM, VOLUME_MAX, type Clip, type MediaClip, type OpInput, type TimelineDoc, type Track } from "@/lib/timeline";
import { placeClips } from "./placement";

// Pure builders for the commands that change how clips sound. Each returns ops and never touches the store; an empty
// list means the command has nothing to do.

export const VOLUME_STEP = 0.1; // one press of the louder or quieter key: ten percent of as recorded

type Sounding = { track: Track; clip: MediaClip };

// A clip with sound of its own: a video or an audio clip. An image, a text, a shape and an empty slot have none.
export function hasOwnSound(clip: Clip): clip is MediaClip {
  return clip.type === "video" || clip.type === "audio";
}

// The clips among these ids that sound, in document order, with their tracks.
export function soundClipsOf(doc: TimelineDoc, clipIds: string[]): Sounding[] {
  const wanted = new Set(clipIds);
  return doc.tracks.flatMap((track) => track.clips.flatMap((clip) => (wanted.has(clip.id) && hasOwnSound(clip) ? [{ track, clip }] : [])));
}

const unlocked = (sounding: Sounding[]) => sounding.filter(({ track }) => !track.locked);

// One step louder (1) or quieter (-1) for every selected clip that sounds, on tenths of as recorded, from silent to
// VOLUME_MAX. Clips on a locked track are left out.
export function volumeStepOps(doc: TimelineDoc, clipIds: string[], direction: 1 | -1): OpInput[] {
  return unlocked(soundClipsOf(doc, clipIds)).flatMap(({ clip }): OpInput[] => {
    const steps = Math.round(clip.volume / VOLUME_STEP) + direction;
    const volume = Math.min(VOLUME_MAX, Math.max(0, Math.round(steps * VOLUME_STEP * 100) / 100));
    return volume === clip.volume ? [] : [{ op: "update_clip", clipId: clip.id, patch: { volume } }];
  });
}

// Silences the selected clips that sound; when every one of them is already silent, puts them back to as recorded.
export function muteOps(doc: TimelineDoc, clipIds: string[]): OpInput[] {
  const clips = unlocked(soundClipsOf(doc, clipIds)).map(({ clip }) => clip);
  const volume = clips.some((clip) => clip.volume > 0) ? 0 : 1;
  return clips.flatMap((clip): OpInput[] => (clip.volume === volume ? [] : [{ op: "update_clip", clipId: clip.id, patch: { volume } }]));
}

export type Separated = { ok: true; ops: OpInput[]; clipIds: string[] } | { ok: false; why: "nothing" | "room" };

// Takes the sound off each selected video clip and puts it on an audio clip of its own, at the same time and from the
// same moment of the same file, on an audio track with room (a new one when none has). The video clip goes silent; its
// volume, fades and captions go with the sound. hasSound says whether a file has any; without it every video counts.
export function separateAudioOps(doc: TimelineDoc, clipIds: string[], genId: () => string, hasSound: (assetId: string) => boolean = () => true): Separated {
  const videos = unlocked(soundClipsOf(doc, clipIds))
    .map(({ clip }) => clip)
    .filter((clip) => clip.type === "video" && clip.volume > 0 && hasSound(clip.assetId));
  if (videos.length === 0) return { ok: false, why: "nothing" };
  const sounds = videos.map((video): MediaClip => {
    const { fadeIn = 0, fadeOut = 0 } = video;
    return {
      id: "",
      type: "audio",
      assetId: video.assetId,
      start: video.start,
      duration: video.duration,
      in: video.in,
      speed: video.speed,
      volume: video.volume,
      transform: { ...DEFAULT_TRANSFORM },
      ...(fadeIn > 0 && { fadeIn }),
      ...(fadeOut > 0 && { fadeOut }),
      ...(video.captions && { captions: true }),
    };
  });
  const placement = placeClips(doc, sounds.map((clip) => ({ clip, trackId: null })), genId);
  if (!placement.ok) return { ok: false, why: "room" };
  const silenced = videos.map((video): OpInput => {
    const patch: Record<string, unknown> = { volume: 0 };
    if ((video.fadeIn ?? 0) > 0) patch.fadeIn = 0;
    if ((video.fadeOut ?? 0) > 0) patch.fadeOut = 0;
    if (video.captions) patch.captions = false;
    return { op: "update_clip", clipId: video.id, patch };
  });
  return { ok: true, ops: [...placement.ops, ...silenced], clipIds: placement.clipIds };
}
