import { describe, expect, it, vi } from "vitest";
import {
  addMedia, addText, addTrack, copySelection, cutSelection, deleteSelection, duplicateSelection, duplicateTrack, goToEdge, moveTrack,
  nudgeSelection, paste, removeTrack, renameTrack, reorderTrack, selectAll, splitAtPlayhead, toggleTrack,
} from "@/lib/editor/actions";
import { CLIPBOARD_KEY, copyClips, createClipboard, pasteItems } from "@/lib/editor/clipboard";
import {
  addTrackOps, copyTrackName, deleteOps, duplicateTrackOps, edgeFrames, moveOps, moveTrackOps, nearestEdge, removeTrackOps, renameTrackOps,
  reorderTrackOps, splitOps, toggleTrackOps,
} from "@/lib/editor/commands";
import { displayRows } from "@/lib/editor/geometry";
import { MESSAGES } from "@/lib/editor/messages";
import { runCommand } from "@/lib/editor/run-command";
import { findClip } from "@/lib/editor/store";
import { TEXT_PRESETS } from "@/lib/editor/text-presets";
import { LIMITS } from "@/lib/limits";
import { applyOps, prepareOps, type Clip, type OpInput, type TimelineDoc, type Track } from "@/lib/timeline";
import { assetView } from "../helpers/media-services";
import { makeStore, noticesOf, sampleDoc, text, video } from "./fixtures";

const ids = (doc: TimelineDoc) => doc.tracks.map((t) => t.id);
const rowIds = (doc: TimelineDoc) => displayRows(doc).map((t) => t.id);
const emptyTrack = (id: string, kind: Track["kind"]): Track => ({ id, kind, name: id, muted: false, hidden: false, locked: false, clips: [] });

describe("clip commands", () => {
  it("orders moves so clips travelling together never collide, and stops at frame 0", () => {
    const pair = [{ clipId: "c1", start: 0 }, { clipId: "c2", start: 30 }];
    expect(moveOps(pair, 10)).toEqual([{ op: "move_clip", clipId: "c2", start: 40 }, { op: "move_clip", clipId: "c1", start: 10 }]);
    expect(() => applyOps(sampleDoc(), prepareOps(moveOps(pair, 10)))).not.toThrow();
    expect(moveOps([{ clipId: "x2", start: 90 }, { clipId: "c2", start: 30 }], -50)).toEqual([
      { op: "move_clip", clipId: "c2", start: 0 }, { op: "move_clip", clipId: "x2", start: 60 },
    ]);
    expect(moveOps(pair, -10)).toEqual([]);
    expect(moveOps([{ clipId: "x2", start: 90 }], 0, "t2")).toEqual([{ op: "move_clip", clipId: "x2", start: 90, trackId: "t2" }]);
  });

  it("moves adjacent clips left without them colliding on the way", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 30, 30), video("c2", 60, 30)];
    const ops = moveOps([{ clipId: "c2", start: 60 }, { clipId: "c1", start: 30 }], -10);
    expect(applyOps(d, prepareOps(ops)).doc.tracks[0].clips.map((c) => [c.id, c.start])).toEqual([["c1", 20], ["c2", 50]]);
  });

  it("splits what the playhead crosses: the selection, or every unlocked track", () => {
    const d = sampleDoc();
    expect(splitOps(d, 45, [])).toEqual([{ op: "split_clip", clipId: "c2", at: 45 }, { op: "split_clip", clipId: "x1", at: 45 }]);
    expect(splitOps(d, 45, ["x1", "x2"])).toEqual([{ op: "split_clip", clipId: "x1", at: 45 }]);
    expect(splitOps(d, 30, [])).toEqual([{ op: "split_clip", clipId: "x1", at: 30 }]); // c1 ends and c2 starts at 30
    expect(splitOps(d, 45, ["x2"])).toEqual([]);
    d.tracks[1].locked = true;
    expect(splitOps(d, 45, [])).toEqual([{ op: "split_clip", clipId: "c2", at: 45 }]);
  });

  it("deletes, with or without closing the gap", () => {
    expect(deleteOps(["x1", "c2"], false)).toEqual([{ op: "remove_clip", clipId: "x1" }, { op: "remove_clip", clipId: "c2" }]);
    expect(applyOps(sampleDoc(), prepareOps(deleteOps(["c1"], true))).doc.tracks[0].clips).toMatchObject([{ id: "c2", start: 0 }]);
  });

  it("finds the clip edges around the playhead", () => {
    const edges = edgeFrames(sampleDoc());
    expect(edges).toEqual([0, 30, 60, 90, 120]);
    expect([nearestEdge(edges, 45, "prev"), nearestEdge(edges, 45, "next"), nearestEdge(edges, 0, "prev"), nearestEdge(edges, 120, "next")]).toEqual([30, 60, 0, 120]);
  });
});

describe("track commands", () => {
  it("adds a track with the next free name, and only one caption track", () => {
    expect(addTrackOps(sampleDoc(), "video")).toEqual([{ op: "add_track", track: { kind: "video", name: "Video 2" }, index: 1 }]);
    expect(addTrackOps(sampleDoc(), "caption")).toEqual([]);
  });

  it("puts a new track just in front of its own kind, or at the end when there is none", () => {
    const after = (kind: Track["kind"]) => applyOps(sampleDoc(), prepareOps(addTrackOps(sampleDoc(), kind), () => "new")).doc;
    expect(rowIds(after("text"))).toEqual(["cap", "new", "t1", "v1", "a1"]); // between Text 1 and Captions
    expect(ids(after("video"))).toEqual(["v1", "new", "t1", "cap", "a1"]);
    expect(ids(after("overlay"))).toEqual(["v1", "t1", "cap", "a1", "new"]);
    expect(ids(after("audio"))).toEqual(["v1", "t1", "cap", "a1", "new"]);
  });

  it("moves a track one row up or down inside its group", () => {
    const d = sampleDoc(); // rows: cap, t1, v1, then audio a1
    const rowsAfter = (ops: OpInput[]) => displayRows(applyOps(d, prepareOps(ops)).doc).map((t) => t.id);
    expect(reorderTrackOps(d, "t1", "up")).toEqual([{ op: "move_track", trackId: "t1", index: 2 }]);
    expect(rowsAfter(reorderTrackOps(d, "t1", "up"))).toEqual(["t1", "cap", "v1", "a1"]);
    expect(rowsAfter(reorderTrackOps(d, "t1", "down"))).toEqual(["cap", "v1", "t1", "a1"]);
    expect([reorderTrackOps(d, "cap", "up"), reorderTrackOps(d, "v1", "down"), reorderTrackOps(d, "a1", "up")]).toEqual([[], [], []]);
  });

  it("swaps exactly one pair of rows when document order and row order are not mirror images", () => {
    const d = sampleDoc();
    d.tracks = [emptyTrack("v1", "video"), emptyTrack("a1", "audio"), emptyTrack("t1", "text"), emptyTrack("cap", "caption"), emptyTrack("a2", "audio"), emptyTrack("o1", "overlay")];
    const rows = rowIds(d);
    expect(rows).toEqual(["o1", "cap", "t1", "v1", "a1", "a2"]);
    const isAudio = (id: string) => id.startsWith("a");
    let moves = 0;
    for (const id of rows) {
      for (const direction of ["up", "down"] as const) {
        const i = rows.indexOf(id);
        const j = direction === "up" ? i - 1 : i + 1;
        const ops = reorderTrackOps(d, id, direction);
        if (j < 0 || j >= rows.length || isAudio(rows[j]) !== isAudio(id)) {
          expect(ops, `${id} ${direction}`).toEqual([]);
          continue;
        }
        const swapped = [...rows];
        [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
        expect(rowIds(applyOps(d, prepareOps(ops)).doc), `${id} ${direction}`).toEqual(swapped);
        moves++;
      }
    }
    expect(moves).toBe(8);
  });

  it("moveTrackOps moves a track to any row in its group", () => {
    const d = sampleDoc();
    d.tracks = [emptyTrack("v1", "video"), emptyTrack("a1", "audio"), emptyTrack("t1", "text"), emptyTrack("cap", "caption"), emptyTrack("a2", "audio"), emptyTrack("o1", "overlay")];
    const rows = rowIds(d); // o1, cap, t1, v1, then audio a1, a2
    const isAudio = (id: string) => id.startsWith("a");
    let moves = 0;
    for (const id of rows) {
      const from = rows.indexOf(id);
      for (let to = 0; to < rows.length; to++) {
        if (isAudio(rows[to]) !== isAudio(id) || to === from) continue;
        const moved = rows.filter((r) => r !== id);
        moved.splice(to, 0, id);
        expect(rowIds(applyOps(d, prepareOps(moveTrackOps(d, id, to))).doc), `${id} to ${to}`).toEqual(moved);
        moves++;
      }
    }
    expect(moves).toBe(14); // 4 rows × 3 others, 2 rows × 1 other
    expect(moveTrackOps(sampleDoc(), "v1", 0)).toEqual([{ op: "move_track", trackId: "v1", index: 2 }]);
    expect(rowIds(applyOps(sampleDoc(), prepareOps(moveTrackOps(sampleDoc(), "v1", 0))).doc)).toEqual(["v1", "cap", "t1", "a1"]);
  });

  it("moveTrack saves one change labeled reorder tracks", () => {
    const store = makeStore();
    moveTrack(store, "v1", 0);
    moveTrack(store, "v1", 0); // already there: nothing
    expect(rowIds(store.getState().doc)).toEqual(["v1", "cap", "t1", "a1"]);
    expect(store.getState().queue.map((e) => e.label)).toEqual(["reorder tracks"]);
  });

  it("it stops at the group's edge and gives nothing for the same row", () => {
    const d = sampleDoc(); // rows: cap, t1, v1, then audio a1
    expect(moveTrackOps(d, "a1", 0)).toEqual([]);
    expect(rowIds(applyOps(d, prepareOps(moveTrackOps(d, "cap", 3))).doc)).toEqual(["t1", "v1", "cap", "a1"]);
    expect([moveTrackOps(d, "t1", 1), moveTrackOps(d, "gone", 0)]).toEqual([[], []]);
  });

  it("renames a track, keeping the old name when the new one is empty", () => {
    const d = sampleDoc();
    expect(renameTrackOps(d, "t1", "  Titles ")).toEqual([{ op: "update_track", trackId: "t1", patch: { name: "Titles" } }]);
    expect([renameTrackOps(d, "t1", "   "), renameTrackOps(d, "t1", "Text 1"), renameTrackOps(d, "gone", "Titles")]).toEqual([[], [], []]);
  });

  it("switches lock, and only the switches a track of that kind offers", () => {
    const d = sampleDoc();
    expect(toggleTrackOps(d, "a1", "locked")).toEqual([{ op: "update_track", trackId: "a1", patch: { locked: true } }]);
    expect(toggleTrackOps(d, "v1", "muted")).toEqual([{ op: "update_track", trackId: "v1", patch: { muted: true } }]);
    expect([toggleTrackOps(d, "a1", "hidden"), toggleTrackOps(d, "t1", "muted"), toggleTrackOps(d, "gone", "locked")]).toEqual([[], [], []]);
    d.tracks[1].hidden = true;
    expect(toggleTrackOps(d, "t1", "hidden")).toEqual([{ op: "update_track", trackId: "t1", patch: { hidden: false } }]);
  });

  it("removes a track only while it is unlocked", () => {
    const d = sampleDoc();
    expect(removeTrackOps(d, "t1")).toEqual([{ op: "remove_track", trackId: "t1" }]);
    d.tracks[1].locked = true;
    expect([removeTrackOps(d, "t1"), removeTrackOps(d, "gone")]).toEqual([[], []]);
  });
});

describe("copy and paste", () => {
  it("copies clips with their tracks and pastes them at the playhead, keeping their spacing", () => {
    const copied = copyClips(sampleDoc(), ["x2", "c1"])!;
    expect(copied.clips.map((c) => [c.clip.id, c.trackId])).toEqual([["c1", "v1"], ["x2", "t1"]]);
    expect(pasteItems(copied, 300).map((item) => [item.clip.start, item.trackId])).toEqual([[300, "v1"], [390, "t1"]]);
    expect(copyClips(sampleDoc(), [])).toBeNull();
  });

  it("copies by start, then in document order, whatever the order of the selection", () => {
    expect(copyClips(sampleDoc(), ["c2", "x1", "c1"])!.clips.map((c) => c.clip.id)).toEqual(["c1", "x1", "c2"]);
  });

  it("reads a stored clipboard with no clips as nothing to paste", () => {
    const store = makeStore();
    const board = createClipboard({ getItem: () => '{"clips":[]}', setItem: () => {} });
    expect(board.read()).toBeNull();
    paste(store, board);
    expect(store.getState().notice).toMatchObject({ tone: "info", text: MESSAGES.nothingToPaste });
  });

  it("keeps the clipboard in storage, and reads garbage as empty", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const copied = copyClips(sampleDoc(), ["x1"])!;
    expect(createClipboard(storage).read()).toBeNull();
    createClipboard(storage).write(copied);
    expect(createClipboard(storage).read()).toEqual(copied);
    data.set(CLIPBOARD_KEY, '{"clips":[{"clip":{"id":"x"},"trackId":"t1"}]}');
    expect(createClipboard(storage).read()).toBeNull();
    const memory = createClipboard();
    memory.write(copied);
    expect(memory.read()).toEqual(copied);
  });

  it("keeps a clip's crop through copy, storage and paste", () => {
    const crop = { left: 0.1, top: 0, right: 0.2, bottom: 0 };
    const doc = sampleDoc();
    doc.tracks[0].clips[0].transform.crop = crop;
    doc.tracks[1].clips[0].transform.crop = crop;
    const board = createClipboard();
    board.write(copyClips(doc, ["c1", "x1"])!);
    const read = board.read()!;
    expect(read.clips.map((c) => c.clip.transform.crop)).toEqual([crop, crop]);
    expect(pasteItems(read, 300).map((item) => item.clip.transform.crop)).toEqual([crop, crop]);
  });

  it("never throws when storage does, and keeps what this tab copied", () => {
    const fail = () => { throw new Error("storage is off"); };
    const copied = copyClips(sampleDoc(), ["x1"])!;
    const broken = createClipboard({ getItem: fail, setItem: fail });
    expect(broken.read()).toBeNull();
    expect(() => broken.write(copied)).not.toThrow();
    expect(broken.read()).toEqual(copied);
    const data = new Map<string, string>([[CLIPBOARD_KEY, "{not json"]]);
    expect(createClipboard({ getItem: (k) => data.get(k) ?? null, setItem: fail }).read()).toBeNull();
  });
});

describe("runners", () => {
  it("edit through the store, one labeled change each", () => {
    const store = makeStore();
    const st = () => store.getState();
    st().seek(45);
    splitAtPlayhead(store);
    st().select(["x2"]);
    nudgeSelection(store, 5);
    deleteSelection(store, false);
    expect(st().queue.map((e) => e.label)).toEqual(["split", "nudge", "delete"]);
    selectAll(store);
    expect(st().selection.clipIds).toHaveLength(5); // c1, both halves of c2, both halves of x1
    st().edit([{ op: "update_track", trackId: "t1", patch: { locked: true } }], "track change");
    selectAll(store);
    expect(st().selection.clipIds).toHaveLength(3); // the clips on the locked track are left out
    goToEdge(store, "next");
    expect(st().playhead).toBe(60);
  });

  it("paste adds new clips and selects them; cut removes the originals", () => {
    const store = makeStore();
    const st = () => store.getState();
    const board = createClipboard();
    st().select(["x2"]);
    copySelection(store, board);
    st().seek(300);
    paste(store, board);
    const pasted = st().doc.tracks[1].clips.find((c) => c.start === 300)!;
    expect(pasted.id).not.toBe("x2");
    expect(st().selection.clipIds).toEqual([pasted.id]);
    st().select(["x1"]);
    cutSelection(store, board);
    expect(findClip(st().doc, "x1")).toBeNull();
    expect(board.read()!.clips[0].clip.id).toBe("x1");
    expect(st().queue.map((e) => e.label)).toEqual(["paste", "cut"]);
  });

  it("paste at a point lands at that frame, on that track when it fits", () => {
    const store = makeStore();
    const st = () => store.getState();
    const notices = noticesOf(store);
    const board = createClipboard();
    const startsOn = (trackId: string) => st().doc.tracks.find((t) => t.id === trackId)!.clips.map((c) => c.start);
    st().select(["x2"]);
    copySelection(store, board);
    paste(store, board, { frame: 200, trackId: "t1" });
    expect(startsOn("t1")).toEqual([0, 90, 200]);
    // Video 1 does not take text, so the copy keeps its own track; at 0 that is taken, so a new one is made.
    paste(store, board, { frame: 0, trackId: "v1" });
    const added = st().doc.tracks.find((t) => t.name === "Text 2")!;
    expect(added.clips.map((c) => [c.type, c.start])).toEqual([["text", 0]]);
    expect(st().selection.clipIds).toEqual([added.clips[0].id]);
    // A wished track that takes the clip wins over the one it was copied from.
    paste(store, board, { frame: 250, trackId: added.id });
    expect(startsOn(added.id)).toEqual([0, 250]);
    expect(startsOn("t1")).toEqual([0, 90, 200]);

    board.write(copyClips(st().doc, ["c1", "x1"])!);
    paste(store, board, { frame: 300, trackId: "v1" });
    expect(startsOn("v1")).toEqual([0, 30, 300]);
    expect(startsOn("t1")).toEqual([0, 90, 200, 300]);
    expect(notices).toEqual([]);
    expect(st().queue.map((e) => e.label)).toEqual(["paste", "paste", "paste", "paste"]);
    // Without a point it still pastes at the playhead.
    st().seek(500);
    paste(store, board);
    expect(startsOn("v1")).toContain(500);
  });

  it("a paste below the last row keeps each clip's own track", () => {
    const store = makeStore();
    const board = createClipboard();
    board.write(copyClips(store.getState().doc, ["c2"])!);
    paste(store, board, { frame: 200, trackId: null });
    expect(store.getState().doc.tracks.find((t) => t.id === "v1")!.clips.map((c) => c.start)).toEqual([0, 30, 200]);
  });

  it("a refused cut leaves the clipboard and the clip alone", () => {
    const d = sampleDoc();
    d.tracks[0].locked = true;
    const store = makeStore({ doc: d });
    const st = () => store.getState();
    const board = createClipboard();
    st().select(["x2"]);
    copySelection(store, board);
    st().select(["c1"]);
    cutSelection(store, board);
    expect(st().notice).toMatchObject({ tone: "error", text: "That track is locked." });
    expect(findClip(st().doc, "c1")).not.toBeNull();
    expect(board.read()!.clips.map((c) => c.clip.id)).toEqual(["x2"]);
  });

  it("a paste the store refuses leaves the selection as it was", () => {
    const store = makeStore();
    const st = () => store.getState();
    const broken = { clips: [{ clip: { ...text("z", 0, 30), duration: 0 }, trackId: "t1" }] };
    st().select(["x1"]);
    st().seek(200);
    paste(store, { read: () => broken, write: () => {} });
    expect(st().notice).toMatchObject({ tone: "error" });
    expect(st().selection.clipIds).toEqual(["x1"]);
    expect(st().queue).toEqual([]);
  });

  it("each command is undone in one step, back to the document before it", () => {
    const withThird = () => { const d = sampleDoc(); d.tracks[0].clips.push(video("c3", 90, 30)); return d; };
    const roundTrip = (name: string, run: (store: ReturnType<typeof makeStore>) => void) => {
      const store = makeStore({ doc: withThird() });
      const before = structuredClone(store.getState().doc);
      run(store);
      expect(store.getState().doc, name).not.toEqual(before);
      expect(store.getState().undoStack, name).toHaveLength(1);
      store.getState().undo();
      expect(store.getState().doc, name).toEqual(before);
    };
    const board = createClipboard();
    roundTrip("split", (s) => { s.getState().seek(45); splitAtPlayhead(s); });
    roundTrip("delete", (s) => { s.getState().select(["x1"]); deleteSelection(s, false); });
    roundTrip("ripple delete", (s) => { s.getState().select(["c1", "c3"]); deleteSelection(s, true); });
    roundTrip("nudge", (s) => { s.getState().select(["x2", "c3"]); nudgeSelection(s, 5); });
    roundTrip("cut", (s) => { s.getState().select(["x1", "c2"]); cutSelection(s, board); });
    roundTrip("paste", (s) => { s.getState().seek(300); paste(s, board); });
    roundTrip("add track", (s) => addTrack(s, "video"));
    roundTrip("rename", (s) => renameTrack(s, "t1", "Titles"));
    roundTrip("toggle", (s) => toggleTrack(s, "v1", "hidden"));
    roundTrip("reorder", (s) => reorderTrack(s, "t1", "up"));
    roundTrip("move track", (s) => moveTrack(s, "v1", 0));
    roundTrip("remove track", (s) => removeTrack(s, "t1"));
    roundTrip("duplicate", (s) => { s.getState().select(["x1", "c3"]); duplicateSelection(s); });
    roundTrip("duplicate track", (s) => duplicateTrack(s, "v1"));
  });

  it("say so when there is nothing to paste or split", () => {
    const store = makeStore();
    paste(store, createClipboard());
    expect(store.getState().notice).toMatchObject({ tone: "info", text: MESSAGES.nothingToPaste });
    store.getState().seek(500);
    splitAtPlayhead(store);
    expect(store.getState().notice).toMatchObject({ tone: "info", text: MESSAGES.nothingToSplit });
    expect(store.getState().queue).toEqual([]);
  });

  it("change tracks through the store, one labeled change each", () => {
    const store = makeStore();
    const st = () => store.getState();
    const track = (id: string) => st().doc.tracks.find((t) => t.id === id);
    addTrack(store, "overlay");
    renameTrack(store, "t1", "Titles");
    toggleTrack(store, "t1", "locked");
    reorderTrack(store, "t1", "up");
    removeTrack(store, "t1"); // locked: nothing happens
    expect(track("t1")).toMatchObject({ name: "Titles", locked: true });
    toggleTrack(store, "t1", "locked");
    removeTrack(store, "t1");
    expect(track("t1")).toBeUndefined();
    expect(st().doc.tracks.map((t) => t.name)).toEqual(["Video 1", "Captions", "Audio 1", "Overlay 1"]);
    expect(st().queue.map((e) => e.label)).toEqual(["add track", "rename track", "track change", "reorder tracks", "track change", "remove track"]);
  });

  it("text and still lengths come from the caller", () => {
    const added = (store: ReturnType<typeof makeStore>) => findClip(store.getState().doc, store.getState().selection.clipIds[0])!.clip;
    const forText = makeStore();
    forText.getState().seek(300);
    addText(forText, TEXT_PRESETS[0], 5);
    expect(added(forText)).toMatchObject({ type: "text", duration: 150 });

    const image = assetView({ id: "i1", kind: "image", durationMs: null, fps: null, hasAudio: false });
    const forImage = makeStore();
    forImage.getState().seek(300);
    addMedia(forImage, image, { stillSeconds: 5 });
    expect(added(forImage)).toMatchObject({ type: "image", duration: 150 });

    // For a video the length is its own; a still length is no cap.
    const forVideo = makeStore();
    forVideo.getState().seek(300);
    addMedia(forVideo, assetView({ durationMs: 2_000 }), { stillSeconds: 5 });
    expect(added(forVideo)).toMatchObject({ type: "video", duration: 60 });
    const shortVideo = makeStore();
    shortVideo.getState().seek(300);
    addMedia(shortVideo, assetView({ durationMs: 2_000 }), { stillSeconds: 1 });
    expect(added(shortVideo)).toMatchObject({ type: "video", duration: 60 });

    // Without a length, the defaults stand.
    const plain = makeStore();
    plain.getState().seek(300);
    addMedia(plain, image);
    expect(added(plain)).toMatchObject({ type: "image", duration: 90 });
  });

  it("do nothing for a viewer, with no message", () => {
    const store = makeStore({ canEdit: false });
    const st = () => store.getState();
    st().seek(45);
    st().select(["x1"]);
    splitAtPlayhead(store);
    deleteSelection(store, true);
    nudgeSelection(store, 5);
    cutSelection(store, createClipboard());
    paste(store, createClipboard());
    moveTrack(store, "v1", 0);
    duplicateSelection(store);
    duplicateTrack(store, "t1");
    st().seek(500);
    splitAtPlayhead(store);
    expect(st()).toMatchObject({ queue: [], notice: null });
    const edit = vi.fn();
    store.setState({ edit });
    duplicateSelection(store);
    duplicateTrack(store, "t1");
    expect(edit).not.toHaveBeenCalled();
  });
});

// The sample project with audio tracks added up to the most tracks a project may have.
const fullDoc = () => {
  const d = sampleDoc();
  for (let i = d.tracks.length; i < LIMITS.tracksPerProject; i++) d.tracks.push(emptyTrack(`a${i}`, "audio"));
  return d;
};

describe("duplicate", () => {
  it("duplicate puts a copy right after the clip and selects it", () => {
    const store = makeStore();
    const st = () => store.getState();
    st().select(["c2"]);
    duplicateSelection(store);
    const v1 = st().doc.tracks.find((t) => t.id === "v1")!;
    const copy = v1.clips.find((c) => c.id !== "c1" && c.id !== "c2")!;
    expect(copy).toMatchObject({ type: "video", start: 60, duration: 30 });
    expect(v1.clips.map((c) => c.start)).toEqual([0, 30, 60]);
    expect(st().selection.clipIds).toEqual([copy.id]);
    expect(st().queue.map((e) => e.label)).toEqual(["duplicate"]);
  });

  it("a copy with no room on its track goes where placement finds room", () => {
    const store = makeStore();
    const st = () => store.getState();
    st().select(["x1"]);
    duplicateSelection(store);
    expect(st().doc.tracks.find((t) => t.id === "t1")!.clips.map((c) => c.id)).toEqual(["x1", "x2"]);
    const added = st().doc.tracks.find((t) => t.name === "Text 2")!;
    expect(added.kind).toBe("text");
    expect(added.clips).toHaveLength(1);
    expect(added.clips[0]).toMatchObject({ type: "text", start: 60, duration: 60 });
    expect(st().selection.clipIds).toEqual([added.clips[0].id]);
  });

  it("two clips keep their spacing", () => {
    const store = makeStore();
    const st = () => store.getState();
    st().select(["c2", "c1"]);
    duplicateSelection(store);
    const v1 = st().doc.tracks.find((t) => t.id === "v1")!;
    expect(v1.clips.map((c) => c.start)).toEqual([0, 30, 60, 90]);
    expect(st().selection.clipIds).toEqual(v1.clips.slice(2).map((c) => c.id));
    expect(st().queue.map((e) => e.label)).toEqual(["duplicate"]);
  });

  it("the copies start where the selection's last clip ends, not where its last-starting clip ends", () => {
    const d = sampleDoc();
    d.tracks[1].clips = [text("x1", 0, 100)]; // 0-100, while c2 is 30-60
    const store = makeStore({ doc: d });
    const st = () => store.getState();
    st().select(["x1", "c2"]);
    duplicateSelection(store);
    const copies = st().selection.clipIds.map((id) => findClip(st().doc, id)!.clip);
    expect(copies.map((c) => [c.type, c.start])).toEqual([["text", 100], ["video", 130]]);
  });

  it("duplicate leaves the clipboard alone and is one undo step", () => {
    const store = makeStore();
    const st = () => store.getState();
    const empty = createClipboard();
    st().select(["c2"]);
    runCommand("duplicate", { store, clipboard: empty, openShortcuts: () => {} });
    expect(empty.read()).toBeNull();
    const board = createClipboard();
    board.write(copyClips(sampleDoc(), ["x1"])!);
    const held = board.read();
    st().select(["c1"]);
    runCommand("duplicate", { store, clipboard: board, openShortcuts: () => {} });
    expect(board.read()).toEqual(held);
    expect(st().queue.map((e) => e.label)).toEqual(["duplicate", "duplicate"]);
    expect(st().undoStack).toHaveLength(2);
    st().undo();
    st().undo();
    expect(st().doc).toEqual(sampleDoc());
  });

  it("does nothing without a selection, and says so when there is no room", () => {
    const store = makeStore();
    duplicateSelection(store);
    expect(store.getState()).toMatchObject({ queue: [], notice: null });
    const full = makeStore({ doc: fullDoc() });
    full.getState().select(["x1"]);
    duplicateSelection(full);
    expect(full.getState().notice).toMatchObject({ tone: "error", text: MESSAGES.noRoom });
    expect(full.getState().queue).toEqual([]);
    expect(full.getState().selection.clipIds).toEqual(["x1"]);
  });

  it("duplicateTrackOps copies a track right above it", () => {
    const d = sampleDoc();
    const ops = duplicateTrackOps(d, "t1", "n");
    expect(ops[0]).toEqual({ op: "add_track", track: { id: "n", kind: "text", name: "Text 1 copy" }, index: 2 });
    const t1 = d.tracks[1];
    expect(ops.slice(1)).toEqual(t1.clips.map((clip) => ({ op: "add_clip", trackId: "n", clip: { ...clip, id: undefined } })));
    for (const op of ops.slice(1)) expect(op.op === "add_clip" && "id" in op.clip).toBe(false);
    const after = applyOps(d, prepareOps(ops)).doc;
    expect(rowIds(after)).toEqual(["cap", "n", "t1", "v1", "a1"]);
    const copy = after.tracks.find((t) => t.id === "n")!;
    const anyId = (clips: Clip[]) => clips.map((clip) => ({ ...clip, id: "?" }));
    expect(anyId(copy.clips)).toEqual(anyId(t1.clips));
    expect(copy.clips.filter((c) => c.id === "x1" || c.id === "x2")).toEqual([]);
    expect(after.tracks.find((t) => t.id === "t1")).toEqual(t1);
    const audio = applyOps(d, prepareOps(duplicateTrackOps(d, "a1", "n"))).doc;
    expect(rowIds(audio)).toEqual(["cap", "t1", "v1", "a1", "n"]);
    const video = applyOps(d, prepareOps(duplicateTrackOps(d, "v1", "n"))).doc;
    expect(rowIds(video)).toEqual(["cap", "t1", "n", "v1", "a1"]);
  });

  it("a copied track keeps hide and mute and is never locked", () => {
    const d = sampleDoc();
    Object.assign(d.tracks[3], { hidden: true, muted: true, locked: true });
    const ops = duplicateTrackOps(d, "a1", "n");
    expect(ops).toEqual([
      { op: "add_track", track: { id: "n", kind: "audio", name: "Audio 1 copy" }, index: 4 },
      { op: "update_track", trackId: "n", patch: { hidden: true, muted: true } },
    ]);
    expect(applyOps(d, prepareOps(ops)).doc.tracks[4]).toMatchObject({ hidden: true, muted: true, locked: false });
    d.tracks[3].hidden = false;
    expect(duplicateTrackOps(d, "a1", "n")[1]).toEqual({ op: "update_track", trackId: "n", patch: { muted: true } });
    d.tracks[3].muted = false;
    d.tracks[0].hidden = true;
    expect(duplicateTrackOps(d, "a1", "n")).toHaveLength(1);
    expect(duplicateTrackOps(d, "v1", "n").at(-1)).toEqual({ op: "update_track", trackId: "n", patch: { hidden: true } });
    expect(duplicateTrackOps(d, "v1", "n").some((op) => op.op === "replace_track")).toBe(false);
  });

  it("no copy of the caption track, a missing track, in a full project, or of a track of 499 clips", () => {
    expect(duplicateTrackOps(sampleDoc(), "cap", "n")).toEqual([]);
    expect(duplicateTrackOps(sampleDoc(), "gone", "n")).toEqual([]);
    expect(duplicateTrackOps(fullDoc(), "t1", "n")).toEqual([]);
    const roomForOne = fullDoc();
    roomForOne.tracks.pop();
    expect(duplicateTrackOps(roomForOne, "t1", "n")).toHaveLength(3);
    const many = (count: number) => {
      const d = sampleDoc();
      d.tracks[1].clips = Array.from({ length: count }, (_, i) => text(`m${i}`, i * 30, 30));
      return d;
    };
    expect(duplicateTrackOps(many(499), "t1", "n")).toEqual([]);
    expect(duplicateTrackOps(many(498), "t1", "n")).toHaveLength(499);
  });

  it("a long name is cut to make room for ' copy'", () => {
    const d = sampleDoc();
    d.tracks[1].name = "x".repeat(LIMITS.trackNameChars);
    const [add] = duplicateTrackOps(d, "t1", "n");
    const name = add.op === "add_track" ? add.track.name : "";
    expect(name).toBe("x".repeat(95) + " copy");
    expect(name).toHaveLength(LIMITS.trackNameChars);
    expect(copyTrackName("Text 1")).toBe("Text 1 copy");
    expect(copyTrackName("Logo ")).toBe("Logo  copy"); // a name that fits is kept as it is
    expect(copyTrackName("a".repeat(94) + "🤖🤖")).toBe("a".repeat(94) + " copy");
    expect(copyTrackName("a".repeat(93) + " 🤖🤖")).toBe("a".repeat(93) + " copy");
  });

  it("duplicateTrack makes one change and selects the new track", () => {
    const store = makeStore();
    const st = () => store.getState();
    st().select(["x1"]);
    duplicateTrack(store, "t1");
    const copy = st().doc.tracks[2];
    expect(copy).toMatchObject({ kind: "text", name: "Text 1 copy" });
    expect(copy.clips).toHaveLength(2);
    expect(st().selection).toEqual({ clipIds: [], trackId: copy.id });
    expect(st().queue.map((e) => e.label)).toEqual(["duplicate track"]);
    duplicateTrack(store, "cap");
    expect(st().queue).toHaveLength(1);
    st().undo();
    expect(st().doc).toEqual(sampleDoc());
  });
});
