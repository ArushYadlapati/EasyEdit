import { isMediaClip, isPlaceholder, slotOf, type Clip, type TimelineDoc } from "./types";

export type SlotKind = "text" | "visual" | "audio";
export type SlotSummary = { name: string; kind: SlotKind; hint?: string; filled: boolean; clipIds: string[] };

function kindOf(clip: Clip): SlotKind {
  if (clip.type === "text") return "text";
  if (clip.type === "audio") return "audio";
  if (clip.type === "placeholder") return clip.accepts;
  return "visual";
}

// Every slot in the doc, in first-appearance order (track order, then start within a track).
export function slotsOf(doc: TimelineDoc): SlotSummary[] {
  const byName = new Map<string, SlotSummary>();
  for (const track of doc.tracks) {
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      const slot = slotOf(clip);
      if (!slot) continue;
      let s = byName.get(slot.name);
      if (!s) {
        s = { name: slot.name, kind: kindOf(clip), filled: true, clipIds: [] };
        if (slot.hint !== undefined) s.hint = slot.hint;
        byName.set(s.name, s);
      }
      s.clipIds.push(clip.id);
      if (isPlaceholder(clip)) s.filled = false;
    }
  }
  // A text slot is always filled, whatever else shares its name.
  for (const s of byName.values()) if (s.kind === "text") s.filled = true;
  return [...byName.values()];
}

// Slot names used by clips of different kinds (text and footage under one name).
export function mixedSlots(doc: TimelineDoc): string[] {
  const kinds = new Map<string, Set<SlotKind>>();
  for (const track of doc.tracks)
    for (const clip of track.clips) {
      const slot = slotOf(clip);
      if (!slot) continue;
      const set = kinds.get(slot.name) ?? new Set<SlotKind>();
      set.add(kindOf(clip));
      kinds.set(slot.name, set);
    }
  return [...kinds].filter(([, set]) => set.size > 1).map(([name]) => name);
}

// A copy of the doc where every slotted video, image and audio clip is an empty placeholder in the same place.
// The caption style stays, so a project made from it looks the same; the words belong to the media it had, which are
// gone, so they are dropped. A clip that stays a media clip keeps its captions switch.
export function toTemplateDoc(doc: TimelineDoc): TimelineDoc {
  const { captions, ...rest } = structuredClone(doc);
  return {
    ...rest,
    ...(captions?.style && { captions: { style: captions.style } }),
    tracks: doc.tracks.map((track) => ({
      ...structuredClone(track),
      clips: track.clips.map((clip): Clip => {
        if (!isMediaClip(clip) || !clip.slot) return structuredClone(clip);
        return {
          id: clip.id,
          type: "placeholder",
          start: clip.start,
          duration: clip.duration,
          transform: structuredClone(clip.transform),
          accepts: clip.type === "audio" ? "audio" : "visual",
          slot: structuredClone(clip.slot),
          // A visual slot keeps its keyframes and transitions, so the clip that fills it moves and fades the same way.
          ...(clip.type !== "audio" && clip.keyframes !== undefined && { keyframes: structuredClone(clip.keyframes) }),
          ...(clip.type !== "audio" && clip.transitionIn !== undefined && { transitionIn: structuredClone(clip.transitionIn) }),
          ...(clip.type !== "audio" && clip.transitionOut !== undefined && { transitionOut: structuredClone(clip.transitionOut) }),
        };
      }),
    })),
  };
}
