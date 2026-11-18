import { describe, expect, it } from "vitest";
import { createEditorStore } from "@/lib/editor/store";
import { TOOLS, toolNeedsEdit } from "@/lib/editor/tools";
import { entry, makeStore, sampleDoc } from "./fixtures";

const guided = () => ({ ...sampleDoc(), guides: [{ id: "gd1", axis: "x" as const, at: 0.5 }] });

describe("the current tool", () => {
  it("starts as Selection and lists the rail's tools in order", () => {
    expect(makeStore().getState().tool).toBe("select");
    expect(TOOLS).toEqual(["select", "razor", "text", "shape", "guide", "crop"]);
    expect(TOOLS.filter(toolNeedsEdit)).toEqual(["razor", "text", "shape", "guide", "crop"]);
  });

  it("changes for an editor", () => {
    const store = makeStore();
    expect(store.getState().setTool("razor")).toBe(true);
    expect(store.getState().tool).toBe("razor");
  });

  it("stays Selection for a viewer", () => {
    const store = makeStore({ canEdit: false });
    expect(store.getState().setTool("razor")).toBe(false);
    expect(store.getState().tool).toBe("select");
    expect(store.getState().setTool("select")).toBe(true);
  });

  it("picking Guide shows the guides, so a placed guide is never hidden", () => {
    const store = makeStore();
    store.getState().setShowGuides(false);
    store.getState().setTool("guide");
    expect(store.getState().showGuides).toBe(true);
    // Hiding them again leaves the Guide tool.
    store.getState().setShowGuides(false);
    expect(store.getState().tool).toBe("select");
  });

  it("leaving Crop disarms the armed clip", () => {
    const store = makeStore();
    store.getState().setTool("crop");
    store.getState().setCropArmed("x1");
    store.getState().setTool("select");
    expect(store.getState().cropArmed).toBeNull();
  });

  it("goes back to Selection when editing access is lost", () => {
    const store = makeStore({ doc: guided() });
    store.getState().setTool("guide");
    store.getState().selectGuide("gd1");
    store.getState().revokeEditing();
    expect(store.getState().tool).toBe("select");
    expect(store.getState().guideId).toBeNull();
  });
});

describe("the selected guide", () => {
  it("selecting a guide clears the clips, and selecting a clip clears the guide", () => {
    const store = makeStore({ doc: guided() });
    store.getState().select(["x1"]);
    store.getState().selectGuide("gd1");
    expect(store.getState().guideId).toBe("gd1");
    expect(store.getState().selection.clipIds).toEqual([]);
    store.getState().select(["x1"]);
    expect(store.getState().guideId).toBeNull();
    store.getState().selectGuide("gd1");
    store.getState().selectTrack(null);
    expect(store.getState().guideId).toBeNull();
  });

  it("ignores a guide that isn't there", () => {
    const store = makeStore({ doc: guided() });
    store.getState().selectGuide("nope");
    expect(store.getState().guideId).toBeNull();
  });

  it("clears when a teammate removes it", () => {
    const store = makeStore({ doc: guided() });
    store.getState().selectGuide("gd1");
    expect(store.getState().applyRemote([entry(6, [{ op: "remove_guide", guideId: "gd1" }])])).toBe(true);
    expect(store.getState().guideId).toBeNull();
  });

  it("clears when undo takes away the guide it added", () => {
    const store = makeStore();
    store.getState().edit([{ op: "add_guide", guide: { id: "new", axis: "y", at: 0.3 } }], "add guide");
    store.getState().selectGuide("new");
    store.getState().undo();
    expect(store.getState().doc.guides).toBeUndefined();
    expect(store.getState().guideId).toBeNull();
  });
});

describe("show guides", () => {
  it("is on unless this browser turned it off, and hiding clears the selected guide", () => {
    expect(makeStore().getState().showGuides).toBe(true);
    const off = createEditorStore(
      { projectId: "p1", name: "n", doc: guided(), version: 1, me: { id: "u1", name: "Ada" }, canEdit: true },
      { view: { snapping: true, showSafeZones: false, showGuides: false } },
    );
    expect(off.getState().showGuides).toBe(false);
    const store = makeStore({ doc: guided() });
    store.getState().selectGuide("gd1");
    store.getState().setShowGuides(false);
    expect(store.getState().showGuides).toBe(false);
    expect(store.getState().guideId).toBeNull();
  });
});
