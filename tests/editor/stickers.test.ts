import { describe, expect, it } from "vitest";
import { addSticker } from "@/lib/editor/actions";
import { STICKERS, STICKER_GROUPS, stickerClip } from "@/lib/editor/stickers";
import { graphemes } from "@/lib/text";
import type { TextClip } from "@/lib/timeline";
import { makeStore, sampleDoc } from "./fixtures";

describe("the stickers", () => {
  it("are four groups of eight, each one picture character with a name of its own", () => {
    expect(STICKER_GROUPS.map((g) => [g.name, g.stickers.length])).toEqual([["Reactions", 8], ["Pointers", 8], ["Marks", 8], ["Things", 8]]);
    expect(new Set(STICKERS.map((s) => s.name)).size).toBe(32);
    expect(new Set(STICKERS.map((s) => s.emoji)).size).toBe(32);
    for (const sticker of STICKERS) expect(graphemes(sticker.emoji), sticker.name).toHaveLength(1);
  });
});

describe("a sticker as a clip", () => {
  const fire = STICKERS.find((s) => s.name === "fire")!;
  it("is a text of that one character, large in the middle of the frame, popping in", () => {
    const clip = stickerClip(fire, 90, { width: 1080, height: 1920, fps: 30 });
    expect(clip).toMatchObject({ type: "text", text: "🔥", start: 90, duration: 90, transform: { x: 0.5, y: 0.5 }, animationIn: { preset: "pop", frames: 8 } });
    expect(clip.style.fontSize).toBe(194); // 18% of the shorter side
    expect(stickerClip(fire, 0, { width: 1920, height: 1080, fps: 60 }, 2)).toMatchObject({ duration: 120, style: { fontSize: 194 }, animationIn: { frames: 15 } });
  });
});

describe("from the editor", () => {
  it("is added at the playhead as one change, selected, and undone whole", () => {
    const store = makeStore();
    store.getState().seek(200);
    const id = addSticker(store, STICKERS[0], 2)!;
    const clip = store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as TextClip;
    expect(clip).toMatchObject({ type: "text", text: "👍", start: 200, duration: 60 });
    expect([store.getState().selection.clipIds, store.getState().queue.at(-1)?.label]).toEqual([[id], "add sticker"]);
    store.getState().undo();
    expect(store.getState().doc).toEqual(sampleDoc());
  });
  it("adds nothing for someone who can't edit", () => {
    const viewer = makeStore({ canEdit: false });
    expect(addSticker(viewer, STICKERS[0])).toBeNull();
    expect(viewer.getState().doc).toEqual(sampleDoc());
  });
});
