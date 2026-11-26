import { createStore, type StoreApi } from "zustand/vanilla";
import type { LibraryStore } from "@/lib/media/library-store";
import { kindFromName, sourceFrames } from "@/lib/media/rules";
import type { AssetView, UploadItem } from "@/lib/media/types";
import type { UploadQueue } from "@/lib/media/upload-queue";
import { TRACK_ACCEPTS, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { addMedia } from "./actions";
import type { TimelinePoint } from "./geometry";
import { mediaClipFor } from "./media-clips";
import type { EditorStore } from "./store";

// The type a library item of this page carries while it is dragged; its data is the asset's id. Lower case, as
// browsers lower-case drag types.
export const ASSET_DRAG_TYPE = "application/x-easyedit-asset";

// What a drag carries: files from the computer, a library item of this page, one of another tab (whose asset this
// page does not hold), or something else.
export type DragKind = "files" | "asset" | "foreign-asset" | null;

// One rule for the window, the timeline and the board. hasAsset: a library item's drag began in this page.
export function dragKind(types: readonly string[], hasAsset: boolean): DragKind {
  if (types.includes(ASSET_DRAG_TYPE)) return hasAsset ? "asset" : "foreign-asset";
  if (types.includes("Files")) return "files";
  return null;
}

// Whether a drag carries files, and not text or a part of the page.
export function carriesFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}

// The track a clip dropped on a row would like: that row when it exists and takes the clip, else none, and placement
// chooses (below the last row, over the ruler, or on a row of another kind).
export function dropTrack(doc: TimelineDoc, rowTrackId: string | null, type: MediaClip["type"]): string | null {
  const row = doc.tracks.find((t) => t.id === rowTrackId);
  return row && TRACK_ACCEPTS[row.kind].includes(type) ? row.id : null;
}

// Starts laid end to end from frame, one per length. From the first unknown length on, no start is known.
export function endToEnd(frame: number, lengths: (number | null)[]): (number | null)[] {
  let at: number | null = frame;
  return lengths.map((length) => {
    const start = at;
    at = at === null || length === null ? null : at + length;
    return start;
  });
}

// How long a file's clip will be, in frames, as mediaClipFor will make it: a still image lasts stillSeconds; a video or
// audio file its length, once the queue has read it.
export function uploadFrames(item: Pick<UploadItem, "fileName" | "durationMs">, fps: number, stillSeconds: number): number | null {
  if (kindFromName(item.fileName) === "image") return Math.max(1, Math.round(stillSeconds * fps));
  return item.durationMs === null ? null : sourceFrames(item.durationMs, fps);
}

// An upload that may still land: not cancelled (its row is there) and not failed in a way a retry cannot mend.
export const liveUpload = (item: UploadItem | undefined): item is UploadItem => item !== undefined && !(item.stage === "failed" && !item.canRetry);

// One dropped file: waiting for its original (pending), being added, on the timeline, or never to land (out: cancelled,
// failed for good, or refused a place). placedFrames: the length it landed with.
export type DropMember = { key: string; state: "pending" | "placing" | "placed" | "out"; placedFrames?: number };
// The files of one drop, laid end to end from frame on the dropped row. stillSeconds is the still length at the drop.
export type DropGroup = { id: string; frame: number; trackId: string | null; stillSeconds: number; members: DropMember[] };

// Where each file of a drop is shown while it waits: its first frame and its length, laid end to end from the drop
// frame as the landing lays them. A length not read yet counts as the drop's still length, so each file shows near
// where it will go; one that will never land takes no room, so the files after it close up.
export function shownSlots(group: DropGroup, uploads: UploadItem[], fps: number): { start: number; length: number }[] {
  const nominal = Math.max(1, Math.round(group.stillSeconds * fps));
  const lengths = group.members.map((member) => {
    if (member.state === "placed") return member.placedFrames ?? 0;
    const item = uploads.find((u) => u.key === member.key);
    if (member.state === "out" || !liveUpload(item)) return 0;
    return uploadFrames(item, fps, group.stillSeconds) ?? nominal;
  });
  const starts = endToEnd(group.frame, lengths);
  return lengths.map((length, i) => ({ start: starts[i]!, length })); // every length is known here, so every start is
}

// What is dragged over the editor, for an editor only.
export type Incoming = "files" | "asset" | null;
// asset: the library item whose drag began in this page, kept until that drag ends. groups: the drops of files still
// waiting to land, oldest first; they live only in this tab.
export type MediaDropState = { incoming: Incoming; asset: AssetView | null; groups: DropGroup[] };

export type MediaDrop = {
  state: StoreApi<MediaDropState>;
  setIncoming(incoming: Incoming): void;
  startAssetDrag(asset: AssetView): void;
  endAssetDrag(): void;
  // Uploads the files, and lands each at its place once its original is in, unselected.
  dropFiles(files: File[], at: TimelinePoint, opts: { stillSeconds: number }): void;
  // Gives a file that still waits a place of its own. It leaves its drop; the files before it keep theirs, and the
  // ones after it stay where they are shown. A file that has landed, or is not waiting, is left alone.
  moveFile(key: string, at: TimelinePoint): void;
  // While a file is held (it is being dragged), nothing lands, as under a drag of a clip. null lets go.
  hold(key: string | null): void;
  start(): () => void; // watches the editor and the library; the function it returns stops that
};

const settled = (member: DropMember) => member.state === "placed" || member.state === "out";

// File and library drags for one open editor. The window's watcher says what is coming in; the panels read it to show
// where a drop would go. Each change is set only when it is one, so nothing re-renders for the many dragover events.
// Dropped files land as their uploads come in: a change to the library or the editor schedules one advance, after
// the change is done, so a drag is saved before anything lands.
export function createMediaDrop(deps: { store: EditorStore; library: LibraryStore; queue: Pick<UploadQueue, "add"> }): MediaDrop {
  const state = createStore<MediaDropState>(() => ({ incoming: null, asset: null, groups: [] }));
  let started = false;
  let scheduled = false;
  let dropped = 0; // how many drops this editor has taken, for their ids
  let held: string | null = null; // the waiting file a person is dragging

  function dropGroups() {
    if (state.getState().groups.length > 0) state.setState({ groups: [] });
  }

  function setMember(groupId: string, index: number, member: DropMember) {
    state.setState((s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, members: g.members.map((m, i) => (i === index ? member : m)) } : g)),
    }));
  }

  // One advance at most is waiting, and it runs outside every store's listener.
  function schedule() {
    if (!started || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (started) advance();
    });
  }

  function advance() {
    const editor = deps.store.getState();
    if (held !== null || editor.gesture !== null || !editor.canEdit || editor.status === "deleted") return;
    for (const { id } of state.getState().groups) advanceGroup(id);
    const groups = state.getState().groups;
    const left = groups.filter((g) => !g.members.every(settled));
    if (left.length < groups.length) state.setState({ groups: left });
  }

  // Each pending member in order: out when its upload is gone or failed for good; landed, once, when its original is
  // in and every length before it is known.
  function advanceGroup(groupId: string) {
    for (let index = 0; ; index++) {
      const group = state.getState().groups.find((g) => g.id === groupId);
      if (!group || index >= group.members.length) return;
      const member = group.members[index];
      if (member.state !== "pending") continue;
      const { uploads, assets } = deps.library.getState();
      const item = uploads.find((u) => u.key === member.key);
      if (!item || (item.stage === "failed" && !item.canRetry)) {
        setMember(groupId, index, { ...member, state: "out" });
        continue;
      }
      const asset = item.assetId !== null && Object.hasOwn(assets, item.assetId) ? assets[item.assetId] : null;
      if (!asset || asset.status !== "ready" || asset.removed) continue;

      const { doc } = deps.store.getState();
      const lengths = group.members.map((m) => {
        if (m.state === "placed") return m.placedFrames ?? 0;
        if (m.state === "out") return 0;
        const upload = uploads.find((u) => u.key === m.key);
        return upload ? uploadFrames(upload, doc.fps, group.stillSeconds) : null;
      });
      const slot = endToEnd(group.frame, lengths)[index];
      if (slot === null) continue;

      setMember(groupId, index, { ...member, state: "placing" });
      const durationSeconds = asset.kind === "image" ? group.stillSeconds : undefined; // as addMedia gives it
      const landed = addMedia(deps.store, asset, {
        frame: slot,
        trackId: dropTrack(doc, group.trackId, asset.kind),
        stillSeconds: group.stillSeconds,
        select: false,
      });
      setMember(
        groupId,
        index,
        landed
          ? { key: member.key, state: "placed", placedFrames: mediaClipFor(asset, slot, doc.fps, { durationSeconds })!.duration }
          : { key: member.key, state: "out" },
      );
    }
  }

  const drop: MediaDrop = {
    state,
    setIncoming(incoming) {
      if (state.getState().incoming !== incoming) state.setState({ incoming });
    },
    startAssetDrag(asset) {
      if (state.getState().asset !== asset) state.setState({ asset });
    },
    endAssetDrag() {
      if (state.getState().asset !== null) state.setState({ asset: null });
    },
    dropFiles(files, at, opts) {
      const keys = deps.queue.add(files);
      if (keys.length === 0) return; // nothing was taken (no storage): no group waits for files that will never come
      dropped += 1;
      const group: DropGroup = {
        id: `drop-${dropped}`,
        frame: at.frame,
        trackId: at.trackId,
        stillSeconds: opts.stillSeconds,
        members: keys.map((key) => ({ key, state: "pending" })),
      };
      state.setState((s) => ({ groups: [...s.groups, group] }));
      schedule(); // a file whose original is already in lands without waiting for another change
    },
    moveFile(key, at) {
      const { groups } = state.getState();
      const from = groups.findIndex((g) => g.members.some((m) => m.key === key && m.state === "pending"));
      if (from < 0) return;
      const group = groups[from];
      const index = group.members.findIndex((m) => m.key === key && m.state === "pending");
      const slots = shownSlots(group, deps.library.getState().uploads, deps.store.getState().doc.fps);
      const waits = (members: DropMember[]) => members.some((m) => !settled(m));
      const before = group.members.slice(0, index);
      const after = group.members.slice(index + 1);
      const parts: DropGroup[] = [];
      if (waits(before)) parts.push({ ...group, members: before });
      dropped += 1;
      parts.push({ ...group, id: `drop-${dropped}`, frame: at.frame, trackId: at.trackId, members: [group.members[index]] });
      if (waits(after)) {
        dropped += 1;
        parts.push({ ...group, id: `drop-${dropped}`, frame: slots[index + 1].start, members: after });
      }
      state.setState({ groups: [...groups.slice(0, from), ...parts, ...groups.slice(from + 1)] });
      schedule(); // it may be ready to land already
    },
    hold(key) {
      if (held === key) return;
      held = key;
      if (key === null) schedule(); // whatever came in meanwhile lands now
    },
    start() {
      started = true;
      const stopEditor = deps.store.subscribe((editor, prev) => {
        // Someone who can no longer edit, or a project that is gone, takes no drop: what was coming in, and every
        // file still to land, is forgotten.
        if (!editor.canEdit || editor.status === "deleted") {
          drop.setIncoming(null);
          drop.endAssetDrag();
          dropGroups();
        }
        if (editor.doc !== prev.doc || editor.gesture !== prev.gesture || editor.canEdit !== prev.canEdit || editor.status !== prev.status) {
          schedule();
        }
      });
      const stopLibrary = deps.library.subscribe((library, prev) => {
        if (library.uploads !== prev.uploads || library.assets !== prev.assets) schedule();
      });
      return () => {
        started = false;
        held = null;
        stopEditor();
        stopLibrary();
        dropGroups();
      };
    },
  };
  return drop;
}
