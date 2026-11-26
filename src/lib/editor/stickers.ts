import { DEFAULT_FONT } from "@/lib/brand/fonts";
import { DEFAULT_TRANSFORM, type TextClip } from "@/lib/timeline";

// Stickers: a picture character (an emoji) put on the frame large, as a text clip of one character, so it is placed,
// sized, turned, keyed and animated like any text and needs no file. It is drawn in the computer's own emoji font:
// the same on the preview and the export of one computer, and a little different from one kind of computer to another.

export type Sticker = { emoji: string; name: string };

// The Text tab's stickers, in its order: reactions, pointers, marks, things.
export const STICKER_GROUPS: readonly { name: string; stickers: readonly Sticker[] }[] = [
  {
    name: "Reactions",
    stickers: [
      { emoji: "👍", name: "thumbs up" }, { emoji: "❤️", name: "heart" }, { emoji: "🔥", name: "fire" }, { emoji: "😂", name: "laughing" },
      { emoji: "😮", name: "surprised" }, { emoji: "👏", name: "clapping" }, { emoji: "🎉", name: "party" }, { emoji: "💯", name: "hundred" },
    ],
  },
  {
    name: "Pointers",
    stickers: [
      { emoji: "👉", name: "pointing right" }, { emoji: "👈", name: "pointing left" }, { emoji: "👆", name: "pointing up" }, { emoji: "👇", name: "pointing down" },
      { emoji: "➡️", name: "arrow right" }, { emoji: "⬅️", name: "arrow left" }, { emoji: "⬆️", name: "arrow up" }, { emoji: "⬇️", name: "arrow down" },
    ],
  },
  {
    name: "Marks",
    stickers: [
      { emoji: "✅", name: "check" }, { emoji: "❌", name: "cross" }, { emoji: "⭐", name: "star" }, { emoji: "❗", name: "exclamation" },
      { emoji: "❓", name: "question" }, { emoji: "💡", name: "idea" }, { emoji: "⚠️", name: "warning" }, { emoji: "🔔", name: "bell" },
    ],
  },
  {
    name: "Things",
    stickers: [
      { emoji: "🏆", name: "trophy" }, { emoji: "🚀", name: "rocket" }, { emoji: "🤖", name: "robot" }, { emoji: "⚙️", name: "gear" },
      { emoji: "🎬", name: "clapperboard" }, { emoji: "🎵", name: "music" }, { emoji: "📣", name: "megaphone" }, { emoji: "📍", name: "pin" },
    ],
  },
];

export const STICKERS: readonly Sticker[] = STICKER_GROUPS.flatMap((group) => group.stickers);
export const STICKER_SECONDS = 3;
const STICKER_SHARE = 0.18; // of the frame's shorter side

// A sticker as a clip: in the middle of the frame, a little under a fifth of its shorter side tall, popping in over a
// quarter of a second. The id is a stand-in: placement gives the clip its real one.
export function stickerClip(sticker: Sticker, start: number, frame: { width: number; height: number; fps: number }, seconds = STICKER_SECONDS): TextClip {
  return {
    id: "sticker",
    type: "text",
    start,
    duration: Math.max(1, Math.round(seconds * frame.fps)),
    text: sticker.emoji,
    transform: { ...DEFAULT_TRANSFORM, x: 0.5, y: 0.5 },
    style: { fontFamily: DEFAULT_FONT, fontSize: Math.round(Math.min(frame.width, frame.height) * STICKER_SHARE), fontWeight: 400, color: "#ffffff", align: "center" },
    animationIn: { preset: "pop", frames: Math.max(1, Math.round(frame.fps / 4)) },
  };
}
