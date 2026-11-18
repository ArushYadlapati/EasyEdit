import type { Clip, MediaClip, OpInput, TimelineDoc } from "@/lib/timeline";
import { slotOf, slotsOf } from "@/lib/timeline";

export type SlotFill = { slot: string; text?: string; assetId?: string; inFrames?: number };
// durationFrames is in frames at the doc's fps; null for images.
export type FillAsset = { id: string; kind: "video" | "image" | "audio"; durationFrames: number | null };

const TAKES = { text: "text", visual: "a video or image", audio: "audio" } as const;

// A slot whose footage is shorter than the slot: the rest of it stays empty.
export type ShortSlot = { slot: string; filledFrames: number; slotFrames: number; trackId: string; endFrame: number };

// The effects a slot's clip carries over to the video or image that fills it: its keyframes and transitions. Sound
// takes none, so an audio fill drops them (an audio slot never has any).
type VisualEffects = Pick<MediaClip, "keyframes" | "transitionIn" | "transitionOut">;

function visualEffects(clip: Clip): VisualEffects {
  if (clip.type === "text" || clip.type === "audio") return {};
  const out: VisualEffects = {};
  if (clip.keyframes !== undefined) out.keyframes = clip.keyframes;
  if (clip.transitionIn !== undefined) out.transitionIn = clip.transitionIn;
  if (clip.transitionOut !== undefined) out.transitionOut = clip.transitionOut;
  return out;
}

// The ops that fill the named slots. Locked tracks are not checked here; applyOps refuses them.
export function fillSlots(
  doc: TimelineDoc,
  fills: SlotFill[],
  assets: ReadonlyMap<string, FillAsset>,
): { ops: OpInput[]; short: ShortSlot[] } | { error: string } {
  const slots = slotsOf(doc);
  const seen = new Set<string>();
  const ops: OpInput[] = [];
  const short: ShortSlot[] = [];

  for (const fill of fills) {
    const name = fill.slot;
    const slot = slots.find((s) => s.name === name);
    if (!slot) {
      return { error: slots.length ? `No slot named ${name}. Slots: ${slots.map((s) => s.name).join(", ")}` : "This project has no slots" };
    }
    if (seen.has(name)) return { error: `${name} is listed twice` };
    seen.add(name);

    const hasText = fill.text !== undefined;
    const hasAsset = fill.assetId !== undefined;
    if (hasText === hasAsset) return { error: `${name}: give text or a media id` };
    if (hasText !== (slot.kind === "text")) return { error: `${name} takes ${TAKES[slot.kind]}` };

    const clips = doc.tracks.flatMap((track) =>
      track.clips.filter((c) => slotOf(c)?.name === name).map((clip) => ({ trackId: track.id, clip })),
    );

    if (hasText) {
      for (const { clip } of clips) ops.push({ op: "update_clip", clipId: clip.id, patch: { text: fill.text } });
      continue;
    }

    const asset = assets.get(fill.assetId!);
    if (!asset) return { error: `No media with id ${fill.assetId}` };
    if ((asset.kind === "audio") !== (slot.kind === "audio")) return { error: `${name} takes ${TAKES[slot.kind]}` };

    const inFrames = fill.inFrames ?? 0;
    for (const { trackId, clip } of clips) {
      let duration = clip.duration;
      if (asset.kind !== "image" && asset.durationFrames !== null) {
        duration = Math.min(clip.duration, asset.durationFrames - inFrames);
      }
      if (duration < 1) return { error: `${name}: the footage has nothing left after the start point` };
      if (duration < clip.duration) short.push({ slot: name, filledFrames: duration, slotFrames: clip.duration, trackId, endFrame: clip.start + duration });
      ops.push({ op: "remove_clip", clipId: clip.id });
      ops.push({
        op: "add_clip",
        trackId,
        clip: {
          id: clip.id,
          type: asset.kind,
          assetId: asset.id,
          start: clip.start,
          duration,
          in: inFrames,
          speed: 1,
          volume: 1,
          transform: clip.transform,
          slot: slotOf(clip)!,
          ...(asset.kind !== "audio" && visualEffects(clip)),
        },
      });
    }
  }
  return { ops, short };
}
