import { describe, expect, it } from "vitest";
import { summarizeOps } from "@/lib/editor/activity";
import { createClipboard } from "@/lib/editor/clipboard";
import { markerAt, markerLabel, neighbourMarker, sortedMarkers, toggleMarkerOps } from "@/lib/editor/markers";
import { runCommand } from "@/lib/editor/run-command";
import { clipEdges } from "@/lib/editor/snap";
import { LIMITS } from "@/lib/limits";
import { applyOps, describe as describeDoc, prepareOps, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc } from "./fixtures";

const ids = () => {
  let n = 0;
  return () => `m${++n}`;
};
const run = (d: TimelineDoc, ops: OpInput[], genId = ids()) => applyOps(d, prepareOps(ops, genId));
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));
const add = (at: number, name = ""): OpInput => ({ op: "add_marker", marker: { at, name } });
// Markers at 2 s "Intro" (m1), 1 s (m2) and 4 s "End" (m3), added in that order.
const marked = () => run(sampleDoc(), [add(60, "Intro"), add(30), add(120, "End")]).doc;

describe("markers in the ops", () => {
  it("are kept with the project in the order added, each with an id", () => {
    const d = marked();
    expect(d.markers).toEqual([{ id: "m1", at: 60, name: "Intro" }, { id: "m2", at: 30, name: "" }, { id: "m3", at: 120, name: "End" }]);
    expect(sortedMarkers(d).map((m) => m.id)).toEqual(["m2", "m1", "m3"]);
    expect(sampleDoc().markers).toBeUndefined();
  });

  it("move and rename, with only what changed in the undo", () => {
    const d = marked();
    const moved = run(d, [{ op: "update_marker", markerId: "m1", patch: { at: 75 } }]);
    expect(moved.doc.markers![0]).toEqual({ id: "m1", at: 75, name: "Intro" });
    expect(moved.inverse).toEqual([{ op: "update_marker", markerId: "m1", patch: { at: 60 }, expect: { at: 75 } }]);
    const renamed = run(moved.doc, [{ op: "update_marker", markerId: "m1", patch: { name: "Hook" } }]);
    expect(applyOps(renamed.doc, roundTrip(renamed.inverse)).doc).toEqual(moved.doc);
    expect(run(d, [{ op: "update_marker", markerId: "m1", patch: { at: 60 } }]).inverse).toEqual([]);
  });

  it("are removed, the last one taking the field with it, and an undo puts each back in its place", () => {
    const d = marked();
    const removed = run(d, [{ op: "remove_marker", markerId: "m2" }]);
    expect(removed.doc.markers!.map((m) => m.id)).toEqual(["m1", "m3"]);
    expect(applyOps(removed.doc, roundTrip(removed.inverse)).doc).toEqual(d);
    const one = run(sampleDoc(), [add(10)]);
    expect(run(one.doc, [{ op: "remove_marker", markerId: "m1" }]).doc.markers).toBeUndefined();
    expect(applyOps(one.doc, roundTrip(one.inverse)).doc).toEqual(sampleDoc());
  });

  it("are guarded and limited", () => {
    const d = marked();
    expect(() => run(d, [{ op: "update_marker", markerId: "m1", patch: { at: 1 }, expect: { at: 99 } }])).toThrow();
    expect(() => run(d, [{ op: "update_marker", markerId: "gone", patch: { at: 1 } }])).toThrow(/marker "gone" not found/);
    expect(() => run(d, [{ op: "remove_marker", markerId: "gone" }])).toThrow(/not found/);
    expect(() => applyOps(d, [{ op: "add_marker", marker: { id: "m1", at: 5, name: "" } }])).toThrow(/already exists/);
    expect(() => run(d, [add(-1)])).toThrow();
    expect(() => run(d, [add(5, "x".repeat(LIMITS.markerNameChars + 1))])).toThrow();
    const full = run(sampleDoc(), Array.from({ length: LIMITS.markersPerProject }, (_, i) => add(i))).doc;
    expect(() => run(full, [add(999)], () => "extra")).toThrow(/at most 200 markers/);
  });

  it("are listed for agents in time order, and named in Activity", () => {
    expect(describeDoc(marked())).toContain('Markers: m2 1.00s, m1 2.00s "Intro", m3 4.00s "End"');
    expect(describeDoc(sampleDoc())).not.toContain("Markers");
    expect(summarizeOps(prepareOps([add(1)], ids()))).toBe("Added a marker");
    expect(summarizeOps([{ op: "remove_marker", markerId: "a" }, { op: "remove_marker", markerId: "b" }])).toBe("Removed 2 markers");
    expect(summarizeOps([{ op: "update_marker", markerId: "a", patch: { at: 3 } }])).toBe("Changed a marker");
  });
});

describe("markers in the editor", () => {
  it("one key adds a marker at the playhead and takes it away again", () => {
    const store = makeStore();
    const ctx = { store, clipboard: createClipboard(), openShortcuts: () => {} };
    store.getState().seek(45);
    runCommand("toggle-marker", ctx);
    expect(store.getState().doc.markers).toMatchObject([{ at: 45, name: "" }]);
    expect(store.getState().queue.at(-1)).toMatchObject({ label: "add marker" });
    runCommand("toggle-marker", ctx);
    expect(store.getState().doc.markers).toBeUndefined();
    expect(toggleMarkerOps(marked(), 60)).toEqual({ ops: [{ op: "remove_marker", markerId: "m1" }], added: false });
    expect(markerAt(marked(), 61)).toBeUndefined();
  });

  it("a viewer adds none", () => {
    const store = makeStore({ canEdit: false });
    runCommand("toggle-marker", { store, clipboard: createClipboard(), openShortcuts: () => {} });
    expect(store.getState().doc.markers).toBeUndefined();
  });

  it("the playhead jumps to the marker before or after it, and stays with none that way", () => {
    const d = marked();
    expect([neighbourMarker(d, 60, "next"), neighbourMarker(d, 60, "prev"), neighbourMarker(d, 120, "next"), neighbourMarker(d, 0, "prev")]).toEqual([120, 30, null, null]);
    const store = makeStore({ doc: d });
    const ctx = { store, clipboard: createClipboard(), openShortcuts: () => {} };
    runCommand("next-marker", ctx);
    runCommand("next-marker", ctx);
    expect(store.getState().playhead).toBe(60);
    runCommand("prev-marker", ctx);
    runCommand("prev-marker", ctx);
    runCommand("prev-marker", ctx);
    expect(store.getState().playhead).toBe(30);
  });

  it("clips, the Razor and the playhead's jumps stop at markers as they do at clip edges", () => {
    // The sample's clips end at 30, 60, 90 and 120; a marker at 45 joins them.
    const d = run(sampleDoc(), [add(45)]).doc;
    expect(clipEdges(sampleDoc(), [])).not.toContain(45);
    expect(clipEdges(d, [])).toContain(45);
    expect(clipEdges(d, ["c1", "c2", "x1", "x2"])).toEqual([45]);
  });

  it("a marker with no name is called Marker", () => {
    expect([markerLabel({ id: "a", at: 0, name: "" }), markerLabel({ id: "a", at: 0, name: "  " }), markerLabel({ id: "a", at: 0, name: "Hook" })]).toEqual(["Marker", "Marker", "Hook"]);
  });
});
