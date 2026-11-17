import type { SlotKind, SlotSummary } from "@/lib/timeline";

export const KIND_WORDS: Record<SlotKind, string> = { text: "text", visual: "video or image", audio: "audio" };

// "hero_clip (video or image), title_text (text)".
export const slotLine = (slots: SlotSummary[]) => slots.map((s) => `${s.name} (${KIND_WORDS[s.kind]})`).join(", ");
