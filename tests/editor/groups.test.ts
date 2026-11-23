import { describe, expect, it } from "vitest";
import { createClipboard } from "@/lib/editor/clipboard";
import { groupOps, ungroupOps, withGroups } from "@/lib/editor/groups";
import { MESSAGES } from "@/lib/editor/messages";
import { runCommand } from "@/lib/editor/run-command";
import { separateAudioOps } from "@/lib/editor/sound";
import { findClip } from "@/lib/editor/store";
import { applyOps, describe as describeDoc, prepareOps, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc } from "./fixtures";

// The sample project: v1 holds c1 and c2, t1 holds x1 and x2.
const ids = () => {
  let n = 0;
  return () => `g${++n}`;
};
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));
const groupOf = (d: TimelineDoc, id: string) => findClip(d, id)!.clip.group ?? null;
const linked = (...clipIds: string[]) => run(sampleDoc(), groupOps(sampleDoc(), clipIds, ids())!).doc;

describe("linking clips", () => {
  it("gives the clips one group, whatever kind they are, and an undo takes it off again", () => {
    const before = sampleDoc();
    const set = run(before, groupOps(before, ["c1", "x1"], ids())!);
    expect([groupOf(set.doc, "c1"), groupOf(set.doc, "x1"), groupOf(set.doc, "c2")]).toEqual(["g1", "g1", null]);
    const undone = applyOps(set.doc, roundTrip(set.inverse)).doc;
    expect([groupOf(undone, "c1"), groupOf(undone, "x1")]).toEqual([null, null]);
  });

  it("needs two clips on unlocked tracks that are not one group already", () => {
    const d = sampleDoc();
    expect(groupOps(d, ["c1"], ids())).toBeNull();
    expect(groupOps(d, [], ids())).toBeNull();
    expect(groupOps(linked("c1", "x1"), ["c1", "x1"], ids())).toBeNull();
    // Two groups, or a group and a loose clip, become one.
    expect(groupOps(linked("c1", "x1"), ["c1", "x1", "c2"], ids())).toHaveLength(3);
    d.tracks[0].locked = true;
    expect(groupOps(d, ["c1", "x1"], ids())).toBeNull();
  });

  it("unlinking takes each selected clip out of its group", () => {
    const d = linked("c1", "c2", "x1");
    const after = run(d, ungroupOps(d, ["c1"])!).doc;
    expect([groupOf(after, "c1"), groupOf(after, "c2"), groupOf(after, "x1")]).toEqual([null, "g1", "g1"]);
    expect(ungroupOps(sampleDoc(), ["c1", "x1"])).toBeNull();
    d.tracks[0].locked = true;
    expect(ungroupOps(d, ["c1"])).toBeNull();
  });

  it("a split keeps both pieces in the group, and the group is named for agents", () => {
    const d = linked("c1", "x1");
    const split = run(d, [{ op: "split_clip", clipId: "c1", at: 10, newClipId: "c9" }]).doc;
    expect(groupOf(split, "c9")).toBe("g1");
    expect(describeDoc(d, { detail: true })).toContain("group=g1");
    expect(describeDoc(sampleDoc(), { detail: true })).not.toContain("group=");
  });

  it("a group's name is short text or nothing", () => {
    const d = sampleDoc();
    expect(() => run(d, [{ op: "update_clip", clipId: "c1", patch: { group: "" } }])).toThrow(/group/);
    expect(() => run(d, [{ op: "update_clip", clipId: "c1", patch: { group: "x".repeat(41) } }])).toThrow(/group/);
    expect(groupOf(run(d, [{ op: "update_clip", clipId: "c1", patch: { group: "intro" } }]).doc, "c1")).toBe("intro");
  });
});

describe("selecting linked clips", () => {
  it("a clip brings its group, in document order; a loose clip stands for itself", () => {
    const d = linked("c2", "x1");
    expect(withGroups(d, ["x1"])).toEqual(["c2", "x1"]);
    expect(withGroups(d, ["c1"])).toEqual(["c1"]);
    expect(withGroups(d, ["c1", "x1"])).toEqual(["c1", "c2", "x1"]);
    expect(withGroups(d, [])).toEqual([]);
    expect(withGroups(sampleDoc(), ["x2", "c1"])).toEqual(["x2", "c1"]); // no groups: as asked
  });
});

describe("Link and Unlink from their keys", () => {
  it("link the selection, say so when there is nothing to do, and undo in one step", () => {
    const store = makeStore();
    const notices = noticesOf(store);
    const ctx = { store, clipboard: createClipboard(), openShortcuts: () => {} };
    runCommand("group-clips", ctx);
    runCommand("ungroup-clips", ctx);
    expect(notices).toEqual([MESSAGES.nothingToGroup, MESSAGES.nothingToUngroup]);
    store.getState().select(["c1", "x1"]);
    runCommand("group-clips", ctx);
    const group = groupOf(store.getState().doc, "c1");
    expect(group).not.toBeNull();
    expect(groupOf(store.getState().doc, "x1")).toBe(group);
    expect(store.getState().queue.at(-1)).toMatchObject({ label: "link clips" });
    runCommand("ungroup-clips", ctx);
    expect(groupOf(store.getState().doc, "c1")).toBeNull();
    store.getState().undo();
    expect(groupOf(store.getState().doc, "c1")).toBe(group);
  });
});

describe("Separate audio", () => {
  it("leaves the video and its sound linked, under the video's own group when it has one", () => {
    const d = sampleDoc();
    const separated = separateAudioOps(d, ["c1"], ids());
    if (!separated.ok) throw new Error(separated.why);
    const after = run(d, separated.ops).doc;
    const sound = separated.clipIds[0];
    expect(groupOf(after, "c1")).not.toBeNull();
    expect(groupOf(after, sound)).toBe(groupOf(after, "c1"));
    expect(withGroups(after, ["c1"])).toEqual(["c1", sound]);
    const grouped = linked("c1", "x1");
    const again = separateAudioOps(grouped, ["c1"], ids());
    if (!again.ok) throw new Error(again.why);
    expect(groupOf(run(grouped, again.ops).doc, again.clipIds[0])).toBe("g1");
  });
});
