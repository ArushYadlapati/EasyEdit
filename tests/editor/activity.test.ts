import { describe, expect, it } from "vitest";
import {
  activityRows,
  canUndoChange,
  editingLabel,
  hasOlderActivity,
  isBeforeMove,
  loadOlderActivity,
  loadRecentActivity,
  olderRange,
  recentRange,
  summarizeOps,
  undoLinks,
  whoLabel,
} from "@/lib/editor/activity";
import { ACTIVITY_LIMIT } from "@/lib/editor/store";
import { DEFAULT_TRANSFORM, type Clip, type Op } from "@/lib/timeline";
import { makeFakeServer } from "./fake-server";
import { entry, makeStore, sampleDoc, text, video } from "./fixtures";

const track = sampleDoc().tracks[1];
const rm = (clipId: string): Op => ({ op: "remove_clip", clipId });

describe("summarizeOps", () => {
  it.each<[Op[], string]>([
    [[{ op: "add_clip", trackId: "t1", clip: text("n", 0, 30) }], "Added text"],
    [[{ op: "add_clip", trackId: "v1", clip: video("n", 0, 30) }], "Added a video clip"],
    [[{ op: "add_track", track: { id: "t2", kind: "text", name: "Text 2" } }, { op: "add_clip", trackId: "t2", clip: text("n", 0, 30) }], "Added text"],
    [[{ op: "add_clip", trackId: "t1", clip: text("n", 0, 30) }, { op: "add_clip", trackId: "v1", clip: video("m", 0, 30) }], "Added 2 clips"],
    [[rm("a")], "Deleted a clip"],
    [[rm("a"), rm("b"), rm("c")], "Deleted 3 clips"],
    [[{ op: "move_clip", clipId: "a", start: 3 }], "Moved a clip"],
    [[{ op: "trim_clip", clipId: "a", edge: "end", to: 9 }], "Trimmed a clip"],
    [[{ op: "split_clip", clipId: "a", at: 5, newClipId: "b" }, { op: "split_clip", clipId: "c", at: 5, newClipId: "d" }], "Split 2 clips"],
    [[{ op: "update_clip", clipId: "a", patch: { text: "x" } }], "Changed text: wording"],
    [[{ op: "update_clip", clipId: "a", patch: { style: { color: "#ff0000", fontSize: 80 } } }], "Changed text: size and color"],
    [[{ op: "update_clip", clipId: "a", patch: { transform: { x: 0.2, y: 0.4 } } }], "Changed a clip: position"],
    [[{ op: "update_clip", clipId: "a", patch: { transform: { scale: 2, x: 0.2, rotation: 5, opacity: 0.5 } } }], "Changed a clip: position, scale, rotation and more"],
    [[{ op: "update_clip", clipId: "a", patch: { volume: 0.5 } }, { op: "update_clip", clipId: "a", patch: { speed: 2 } }], "Changed a clip: speed and volume"],
    [[{ op: "update_clip", clipId: "a", patch: { transform: { scale: 2 } } }, { op: "update_clip", clipId: "b", patch: { transform: { scale: 2 } } }], "Changed 2 clips: scale"],
    [[{ op: "update_clip", clipId: "a", patch: {} }], "Edited a clip"],
    [[{ op: "update_track", trackId: "v1", patch: { name: "Main" } }], "Renamed a track"],
    [[{ op: "update_track", trackId: "v1", patch: { locked: true } }], "Locked a track"],
    [[{ op: "update_track", trackId: "v1", patch: { hidden: false } }], "Showed a track"],
    [[{ op: "update_track", trackId: "v1", patch: { muted: true } }], "Muted a track"],
    [[{ op: "update_track", trackId: "v1", patch: { name: "Main", muted: true } }], "Changed a track"],
    [[{ op: "add_track", track: { id: "t2", kind: "text", name: "Text 2" } }], "Added a track"],
    [[{ op: "remove_track", trackId: "t1" }], "Removed a track"],
    [[{ op: "move_track", trackId: "t1", index: 0 }], "Reordered tracks"],
    [[{ op: "replace_track", track, index: 1, restore: true }], "Restored a track"],
    [[{ op: "set_format", format: "long_16x9" }], "Changed the format to Landscape 16:9"],
    [[{ op: "set_format", format: "custom", width: 816, height: 1056 }], "Changed the format to Custom 816 × 1056"],
    [[{ op: "set_safe_area", format: "short_9x16", size: { width: 0.875, height: 0.6 } }], "Resized the safe area to 87.5% × 60%"],
    [[{ op: "set_safe_area", format: "short_9x16", size: null }], "Reset the safe area"],
    [[{ op: "set_safe_area", format: "short_9x16", size: null }, { op: "set_format", format: "long_16x9" }], "Changed the format and changed the safe area"],
    [[{ op: "add_guide", guide: { id: "g1", axis: "x", at: 0.5 } }], "Added a guide"],
    [[{ op: "move_guide", guideId: "g1", at: 0.4 }], "Moved a guide"],
    [[{ op: "remove_guide", guideId: "g1" }], "Removed a guide"],
    [[{ op: "add_guide", guide: { id: "g1", axis: "x", at: 0.5 } }, { op: "add_guide", guide: { id: "g2", axis: "y", at: 0.5 } }], "Added 2 guides"],
    [[{ op: "move_guide", guideId: "g1", at: 0.4 }, { op: "move_clip", clipId: "a", start: 3 }], "Moved a clip and changed guides"],
    [[{ op: "move_clip", clipId: "a", start: 3 }, rm("b")], "Deleted a clip and moved a clip"],
    [[rm("a"), { op: "add_clip", trackId: "t1", clip: text("n", 0, 30) }, { op: "add_clip", trackId: "t1", clip: text("m", 30, 30) }, { op: "update_clip", clipId: "b", patch: { text: "x" } }],
      "Added 2 clips, deleted a clip and edited a clip"],
    [[{ op: "set_format", format: "long_16x9" }, { op: "update_track", trackId: "v1", patch: { locked: true } }, { op: "move_clip", clipId: "a", start: 3 }, { op: "trim_clip", clipId: "a", edge: "end", to: 9 }, { op: "split_clip", clipId: "a", at: 5, newClipId: "b" }],
      "Moved a clip, trimmed a clip, split a clip and more"],
    [[{ op: "add_track", track: { id: "t2", kind: "text", name: "Text 2" } }, { op: "move_track", trackId: "t2", index: 0 }], "Changed tracks"],
    [[{ op: "add_track", track: { id: "t2", kind: "text", name: "Text 2" } }, { op: "add_clip", trackId: "t2", clip: text("n", 0, 30) }, rm("a")], "Added a clip, deleted a clip and changed tracks"],
    // Auto captions: the track, the style, the words, dropped words of unused files, and the clip switches.
    [[{ op: "add_track", track: { id: "c", kind: "caption", name: "Captions" } }, { op: "set_caption_style", patch: { preset: "karaoke" } }, { op: "set_transcript", assetId: "z", words: null }, { op: "set_transcript", assetId: "a", words: [{ t: "hi", s: 0, e: 100 }] }, { op: "update_clip", clipId: "v", patch: { captions: true } }], "Added captions"],
    [[{ op: "set_transcript", assetId: "a", words: [{ t: "hi", s: 0, e: 100 }] }, { op: "update_clip", clipId: "v", patch: { captions: true } }, { op: "update_clip", clipId: "w", patch: { captions: true } }], "Added captions"],
    [[{ op: "update_clip", clipId: "v", patch: { captions: true } }], "Added captions"],
    [[{ op: "update_clip", clipId: "v", patch: { captions: false } }], "Removed captions"],
    [[{ op: "update_clip", clipId: "v", patch: { captions: false } }, { op: "update_clip", clipId: "w", patch: { captions: false } }], "Removed captions"],
    // Transcribe again, or an agent's words: the words change.
    [[{ op: "set_transcript", assetId: "a", words: [{ t: "hi", s: 0, e: 100 }] }], "Changed the captions"],
    [[{ op: "update_clip", clipId: "v", patch: { captions: false, volume: 0.5 } }], "Changed a clip: volume"],
    [[{ op: "update_clip", clipId: "v", patch: { captions: true } }, rm("b")], "Deleted a clip and edited a clip"],
  ])("%#", (ops, summary) => {
    expect(summarizeOps(ops)).toBe(summary);
  });
});

describe("summarizeOps with the kind of each clip known", () => {
  const kinds: Record<string, "text" | "video" | "image" | "audio"> = { t: "text", v: "video", i: "image", a: "audio" };
  const kindOf = (id: string) => kinds[id];
  it.each<[Op[], string]>([
    [[{ op: "update_clip", clipId: "v", patch: { transform: { scale: 2, y: 0.4 } } }], "Changed a video clip: position and scale"],
    [[{ op: "update_clip", clipId: "a", patch: { volume: 0.5 } }], "Changed an audio clip: volume"],
    [[{ op: "update_clip", clipId: "i", patch: { transform: { opacity: 0.5 } } }], "Changed an image: opacity"],
    [[{ op: "update_clip", clipId: "t", patch: { transform: { x: 0.1 } } }], "Changed text: position"],
    [[{ op: "update_clip", clipId: "v", patch: { transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } } }], "Changed a video clip: crop"],
    [[{ op: "update_clip", clipId: "t", patch: { transform: { crop: { left: 0, top: 0, right: 0, bottom: 0 } } } }], "Changed text: crop"],
    [[{ op: "update_clip", clipId: "i", patch: { volume: 1, transform: { crop: { left: 0, top: 0.2, right: 0, bottom: 0 }, fit: "contain" } } }], "Changed an image: fit, crop and volume"],
    [[{ op: "update_clip", clipId: "t", patch: { transform: { x: 0.4, scale: 2, stretch: 1.5 } } }], "Changed text: position, scale and stretch"],
    [[{ op: "update_clip", clipId: "v", patch: { transform: { rotation: 5, stretch: 0.5 } } }], "Changed a video clip: stretch and rotation"],
    [[{ op: "move_clip", clipId: "t", start: 3 }], "Moved text"],
    [[{ op: "move_clip", clipId: "v", start: 3 }], "Moved a video clip"],
    [[{ op: "trim_clip", clipId: "a", edge: "end", to: 9 }], "Trimmed an audio clip"],
    [[{ op: "split_clip", clipId: "i", at: 5, newClipId: "b" }], "Split an image"],
    [[rm("v")], "Deleted a video clip"],
    [[rm("unknown")], "Deleted a clip"],
    [[rm("v"), rm("t")], "Deleted 2 clips"],
  ])("%#", (ops, summary) => {
    expect(summarizeOps(ops, kindOf)).toBe(summary);
  });
});

describe("activity helpers", () => {
  it("only entries with a stored, non-empty inverse can be undone", () => {
    expect(canUndoChange(entry(6, [rm("a")]))).toBe(false);
    expect(canUndoChange({ ...entry(6, [rm("a")]), inverse: [] })).toBe(false);
    expect(canUndoChange({ ...entry(6, [rm("a")]), inverse: [rm("b")] })).toBe(true);
  });

  it("names me as You, and Claude as Claude", () => {
    expect(whoLabel(entry(6, [], "u1", "Ada"), "u1")).toBe("You");
    expect(whoLabel(entry(6, [], "claude:u1", "Claude (for Ada)"), "u1")).toBe("Claude (for Ada)");
    expect(whoLabel(entry(6, [], "u2", "Grace"), "u1")).toBe("Grace");
  });

  it("labels who is editing", () => {
    expect(editingLabel([])).toBeNull();
    expect(editingLabel(["Grace", "Grace"])).toBe("Grace is editing…");
    expect(editingLabel(["Claude (for Ada)"])).toBe("Claude is editing…");
    expect(editingLabel(["Grace", "Claude"])).toBe("2 people are editing…");
    expect(editingLabel(["Claudette"])).toBe("Claudette is editing…");
    expect(editingLabel(["Claudette", "Claude (for Ada)"])).toBe("2 people are editing…");
    expect(editingLabel(["Cursor (for Ada)", "Cursor"])).toBe("Cursor is editing…");
    expect(editingLabel(["Claude Code (for Ada)"])).toBe("Claude Code is editing…");
    expect(editingLabel(["VS Code (Copilot) (for Ada)"])).toBe("VS Code (Copilot) is editing…");
    expect(editingLabel(["AI agent (for Ada)"])).toBe("AI agent is editing…");
    expect(editingLabel(["Claude (for Ada)", "ChatGPT (for Grace)"])).toBe("2 people are editing…");
  });

  it("pages the log 50 changes at a time", () => {
    expect(recentRange(0)).toBeNull();
    expect(recentRange(12)).toEqual({ since: 0, limit: 12 });
    expect(recentRange(120)).toEqual({ since: 70, limit: 50 });
    expect(olderRange(71)).toEqual({ since: 20, limit: 50 });
    expect(olderRange(21)).toEqual({ since: 0, limit: 20 });
    expect(olderRange(1)).toBeNull();
  });
});

describe("the activity list", () => {
  it("rows are newest first, with who, what, when and whether they can be undone", () => {
    const rows = activityRows([
      { ...entry(6, [rm("a")], "u1", "Ada"), inverse: [rm("b")] },
      entry(7, [{ op: "set_format", format: "long_16x9" }], "claude:u2", "Claude (for Grace)"),
    ], "u1", new Date("2026-11-11T10:05:00.000Z"));
    expect(rows).toEqual([
      { version: 7, who: "Claude (for Grace)", summary: "Changed the format to Landscape 16:9", when: "5 minutes ago", canUndo: false, beforeMove: false, undone: false, clipIds: [] },
      { version: 6, who: "You", summary: "Deleted a clip", when: "5 minutes ago", canUndo: true, beforeMove: false, undone: false, clipIds: [] },
    ]);
  });

  it("after a move, the move reads as one and changes from before it cannot be undone, even with an undo in hand", () => {
    const rows = activityRows([
      { ...entry(5, [rm("a")], "u1", "Ada"), inverse: [rm("b")] },
      entry(6, [{ op: "update_clip", clipId: "c1", patch: { assetId: "copy-a" } }], "u2", "Grace"),
      { ...entry(7, [rm("c")], "u1", "Ada"), inverse: [rm("d")] },
    ], "u1", new Date("2026-11-11T10:05:00.000Z"), { movedAtVersion: 6 });
    expect(rows.map(({ version, who, summary, canUndo, beforeMove }) => ({ version, who, summary, canUndo, beforeMove }))).toEqual([
      { version: 7, who: "You", summary: "Deleted a clip", canUndo: true, beforeMove: false },
      { version: 6, who: "Grace", summary: "Moved here from another space", canUndo: false, beforeMove: false },
      { version: 5, who: "You", summary: "Deleted a clip", canUndo: false, beforeMove: true },
    ]);
    expect(isBeforeMove(entry(5, []), 6)).toBe(true);
    expect(isBeforeMove(entry(6, []), 6)).toBe(false);
    expect(isBeforeMove(entry(1, []), null)).toBe(false);
  });

  it("names the kind of clip from the project, and from the change itself when the clip is gone", () => {
    const doc = sampleDoc();
    const textClip = doc.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!;
    const rows = activityRows([
      entry(3, [{ op: "move_clip", clipId: textClip.id, start: 300 }]),
      { ...entry(4, [rm("gone")]), inverse: [{ op: "add_clip", trackId: "v1", clip: video("gone", 0, 30) }] },
    ], "u1", new Date("2026-11-11T10:05:00.000Z"), { doc });
    expect(rows.map((r) => r.summary)).toEqual(["Deleted a video clip on Video 1", "Moved text “hi”"]);
    expect(rows.map((r) => r.clipIds)).toEqual([[], [textClip.id]]);
  });

  it("names each clip by its words, its file's name, or its kind and track", () => {
    const doc = sampleDoc();
    doc.tracks[1].clips[0] = text("x1", 0, 60, { text: "Kickoff day at the lake with everyone from school" });
    const now = new Date("2026-11-11T10:05:00.000Z");
    const shape = { id: "s1", type: "shape", shape: "rect", start: 0, duration: 30, transform: { ...DEFAULT_TRANSFORM } } as unknown as Clip;
    const rows = activityRows([
      entry(3, [{ op: "move_clip", clipId: "x1", start: 300 }]),
      entry(4, [{ op: "update_clip", clipId: "c1", patch: { volume: 0.5 } }]),
      entry(5, [{ op: "update_clip", clipId: "x2", patch: { text: "Summer trip" } }]),
      entry(6, [{ op: "update_clip", clipId: "x2", patch: { text: "Summer", style: { color: "#ff0000" } } }]),
      entry(7, [{ op: "add_clip", trackId: "t1", clip: shape }]),
    ], "u1", now, { doc, assetName: (id) => (id === "a" ? "beach.mp4" : undefined) });
    expect(rows.map((r) => r.summary).reverse()).toEqual([
      "Moved text “Kickoff day at the lake with ev…”",
      "Changed “beach.mp4”: volume",
      "Changed text to “Summer trip”",
      "Changed text “hi”: wording and color",
      "Added a shape on Text 1",
    ]);
  });

  it("an undo reads as one and marks what it undid; undoing it again is a redo", () => {
    const add: Op[] = [{ op: "add_clip", trackId: "t1", clip: text("n1", 200, 30) }];
    const remove: Op[] = [{ op: "remove_clip", clipId: "n1" }];
    const now = new Date("2026-11-11T10:05:00.000Z");
    const log = [
      { ...entry(6, add, "u2", "Theo"), inverse: remove },
      { ...entry(7, remove, "u1", "Ada"), inverse: add },
    ];
    expect(activityRows(log, "u1", now).map(({ summary, canUndo, undone }) => ({ summary, canUndo, undone }))).toEqual([
      { summary: "Undid: Added text “hi” (Theo's)", canUndo: true, undone: false },
      { summary: "Added text “hi”", canUndo: false, undone: true },
    ]);
    const redone = activityRows([...log, { ...entry(8, add, "u1", "Ada"), inverse: remove }], "u1", now);
    expect(redone.map(({ summary, undone }) => ({ summary, undone }))).toEqual([
      { summary: "Redid: Added text “hi” (Theo's)", undone: false },
      { summary: "Undid: Added text “hi” (Theo's)", undone: true },
      { summary: "Added text “hi”", undone: false },
    ]);
    // A teammate undoing my change says it was mine.
    const mine = [{ ...entry(6, add, "u1", "Ada"), inverse: remove }, { ...entry(7, remove, "u2", "Theo"), inverse: add }];
    expect(activityRows(mine, "u1", now)[0].summary).toBe("Undid: Added text “hi” (yours)");
  });

  it("an undo sent by the store matches the change it undoes as the log keeps it", async () => {
    const server = makeFakeServer(sampleDoc(), 5);
    server.remote([{ op: "update_clip", clipId: "x1", patch: { text: "GO", style: { color: "#ff0000" } } }]);
    server.remote([{ op: "move_clip", clipId: "x2", start: 200 }]);
    const store = makeStore({ doc: server.doc(), version: 7 });
    store.getState().undoChange(server.log[0]);
    const sent = store.getState().queue[0];
    expect((await server.api.postOps({ baseVersion: 7, ops: sent.ops })).ok).toBe(true);
    expect(undoLinks(server.log).undid).toEqual(new Map([[8, 6]]));
  });

  it("loads the last 50 changes, then earlier ones on request", async () => {
    const server = makeFakeServer(sampleDoc(), 0);
    for (let i = 0; i < 120; i++) server.remote([{ op: "update_track", trackId: "v1", patch: { name: `V${i}` } }]);
    const store = makeStore({ doc: server.doc(), version: 120 });
    expect(await loadRecentActivity(server.api, store)).toBe(true);
    expect(store.getState().activity.map((e) => e.version)).toEqual(Array.from({ length: 50 }, (_, i) => 71 + i));
    expect(hasOlderActivity(store.getState().activity)).toBe(true);
    expect(await loadOlderActivity(server.api, store)).toBe(true);
    expect(store.getState().activity[0].version).toBe(21);
    server.fail("network");
    expect(await loadOlderActivity(server.api, store)).toBe(false);
    expect(hasOlderActivity([entry(1, [])])).toBe(false);
  });

  it("keeps asking while a page is cut short, and loads the whole range", async () => {
    const server = makeFakeServer(sampleDoc(), 0);
    for (let i = 0; i < 12; i++) server.remote([{ op: "update_track", trackId: "v1", patch: { name: `V${i}` } }]);
    const store = makeStore({ doc: server.doc(), version: 12 });
    const short: typeof server.api = {
      ...server.api,
      getOpsSince: async (since, limit) => server.api.getOpsSince(since, Math.min(limit ?? 100, 5)),
    };
    expect(await loadRecentActivity(short, store)).toBe(true);
    expect(store.getState().activity.map((e) => e.version)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("makes no request when there is nothing to ask for", async () => {
    const server = makeFakeServer(sampleDoc(), 0);
    const store = makeStore({ doc: server.doc(), version: 0 });
    expect(await loadRecentActivity(server.api, store)).toBe(true);
    expect(await loadOlderActivity(server.api, store)).toBe(true);
    expect(server.calls).toEqual([]);
  });

  it("stops offering earlier changes once the list holds the most it keeps", () => {
    const full = Array.from({ length: ACTIVITY_LIMIT }, (_, i) => entry(500 + i, []));
    expect(hasOlderActivity(full)).toBe(false);
    expect(hasOlderActivity(full.slice(1))).toBe(true);
  });
});
