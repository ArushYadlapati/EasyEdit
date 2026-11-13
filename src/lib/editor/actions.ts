import { nanoid } from "nanoid";
import type { AssetView } from "@/lib/media/types";
import { NO_CROP, TRACK_ACCEPTS, isCropped, type OpInput, type TrackKind } from "@/lib/timeline";
import { copyClips, pasteItems, type ClipboardStore } from "./clipboard";
import {
  addTrackOps,
  deleteOps,
  duplicateTrackOps,
  edgeFrames,
  moveOps,
  moveTrackOps,
  nearestEdge,
  removeTrackOps,
  renameTrackOps,
  reorderTrackOps,
  splitOps,
  toggleTrackOps,
  type TrackSwitch,
} from "./commands";
import type { TimelinePoint } from "./geometry";
import { mediaClipFor } from "./media-clips";
import { MESSAGES } from "./messages";
import { placeClips } from "./placement";
import { findClip, type EditorStore } from "./store";
import { presetClip, type TextPreset } from "./text-presets";

// Puts a text preset at the playhead, on the selected text track when it has room, and selects it. The length in
// seconds is the caller's (Settings), else the default.
export function addText(store: EditorStore, preset: TextPreset, seconds?: number): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const selected = state.doc.tracks.find((t) => t.id === state.selection.trackId);
  const trackId = selected?.kind === "text" ? selected.id : null;
  const placement = placeClips(state.doc, [{ clip: presetClip(preset, state.playhead, state.doc.fps, seconds), trackId }], () => nanoid(10));
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return;
  }
  const result = state.edit(placement.ops, "add text");
  if (result.ok) state.select(placement.clipIds);
}

// Puts a clip of a library asset at the frame given, else the playhead, and selects it. The clip would like the track
// given, else the selected track when that track takes it; placeClips finds where it goes. A still image lasts
// stillSeconds (Settings), else the default; a video or audio clip runs to the end of its media.
export function addMedia(
  store: EditorStore,
  asset: AssetView,
  opts: { frame?: number; trackId?: string | null; stillSeconds?: number } = {},
): void {
  const state = store.getState();
  if (!state.canEdit) return;
  // For video and audio durationSeconds would cap the length, so only an image is given one.
  const length = { durationSeconds: asset.kind === "image" ? opts.stillSeconds : undefined };
  const clip = asset.status === "ready" && !asset.removed ? mediaClipFor(asset, opts.frame ?? state.playhead, state.doc.fps, length) : null;
  if (!clip) {
    state.notify("info", MESSAGES.mediaNotReady);
    return;
  }
  const selected = state.doc.tracks.find((t) => t.id === state.selection.trackId);
  const trackId = opts.trackId !== undefined ? opts.trackId : selected && TRACK_ACCEPTS[selected.kind].includes(clip.type) ? selected.id : null;
  // The id is a stand-in, as presetClip's is: placement gives the clip its real one.
  const placement = placeClips(state.doc, [{ clip: { ...clip, id: "new" }, trackId }], () => nanoid(10));
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return;
  }
  const result = state.edit(placement.ops, "add media");
  if (result.ok) state.select(placement.clipIds);
}

// The runners below edit the project. For a viewer they do nothing and say nothing.

// Cuts the selected clips under the playhead, or every clip under it on unlocked tracks.
export function splitAtPlayhead(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const ops = splitOps(state.doc, state.playhead, state.selection.clipIds);
  if (ops.length === 0) state.notify("info", MESSAGES.nothingToSplit);
  else state.edit(ops, "split");
}

export function deleteSelection(store: EditorStore, ripple: boolean): void {
  const state = store.getState();
  const ids = state.selection.clipIds;
  if (!state.canEdit || ids.length === 0) return;
  state.edit(deleteOps(ids, ripple), ripple ? "ripple delete" : "delete");
}

export function nudgeSelection(store: EditorStore, deltaFrames: number): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const clips = state.selection.clipIds.flatMap((clipId) => {
    const found = findClip(state.doc, clipId);
    return found ? [{ clipId, start: found.clip.start }] : [];
  });
  const ops = moveOps(clips, deltaFrames);
  if (ops.length > 0) state.edit(ops, "nudge");
}

// Clips on locked tracks are left out, so a following delete or nudge is not refused as a whole.
export function selectAll(store: EditorStore): void {
  const state = store.getState();
  state.select(state.doc.tracks.flatMap((t) => (t.locked ? [] : t.clips.map((c) => c.id))));
}

// Moves the playhead to the nearest clip edge before or after it.
export function goToEdge(store: EditorStore, direction: "prev" | "next"): void {
  const state = store.getState();
  state.seek(nearestEdge(edgeFrames(state.doc), state.playhead, direction));
}

// Copying changes nothing, so a viewer can copy too.
export function copySelection(store: EditorStore, clipboard: ClipboardStore): void {
  const state = store.getState();
  const copied = copyClips(state.doc, state.selection.clipIds);
  if (copied) clipboard.write(copied);
}

export function cutSelection(store: EditorStore, clipboard: ClipboardStore): void {
  const state = store.getState();
  const ids = state.selection.clipIds;
  if (!state.canEdit || ids.length === 0) return;
  // Copied first, but kept only once the delete went through: a refused cut leaves the clipboard alone.
  const copied = copyClips(state.doc, ids);
  if (state.edit(deleteOps(ids, false), "cut").ok && copied) clipboard.write(copied);
}

// Puts the clipboard's clips at the playhead, or at the point given, where placeClips finds room, and selects
// them. Each clip would like the point's track when that track takes it, else the track it was copied from.
// A point below the last row (trackId null) has no wished track: placement chooses.
export function paste(store: EditorStore, clipboard: ClipboardStore, at?: TimelinePoint): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const copied = clipboard.read();
  if (!copied) {
    state.notify("info", MESSAGES.nothingToPaste);
    return;
  }
  const target = state.doc.tracks.find((t) => t.id === at?.trackId);
  const items = pasteItems(copied, at?.frame ?? state.playhead).map((item) => {
    if (at && at.trackId === null) return { ...item, trackId: null };
    return target && TRACK_ACCEPTS[target.kind].includes(item.clip.type) ? { ...item, trackId: target.id } : item;
  });
  const placement = placeClips(state.doc, items, () => nanoid(10));
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return;
  }
  const result = state.edit(placement.ops, "paste");
  if (result.ok) state.select(placement.clipIds);
}

// Puts copies of the selected clips right after the selection, on their own tracks when free, else
// where placeClips finds room, and selects them. Nothing ripples, and the clipboard is left alone.
export function duplicateSelection(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const copied = copyClips(state.doc, state.selection.clipIds);
  if (!copied) return;
  const end = Math.max(...copied.clips.map(({ clip }) => clip.start + clip.duration));
  const placement = placeClips(state.doc, pasteItems(copied, end), () => nanoid(10));
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return;
  }
  const result = state.edit(placement.ops, "duplicate");
  if (result.ok) state.select(placement.clipIds);
}

// Shows the whole of a cropped clip again, in one change labeled "crop". Nothing to do for an uncropped clip, or while
// a drag or a typed value is live.
export function resetCrop(store: EditorStore, clipId: string): void {
  const state = store.getState();
  const clip = findClip(state.doc, clipId)?.clip;
  if (!state.canEdit || state.gesture !== null || !clip || !isCropped(clip.transform.crop)) return;
  state.edit([{ op: "update_clip", clipId, patch: { transform: { crop: { ...NO_CROP } } } }], "crop");
}

// Track runners, used by the track headers, the timeline toolbar and the inspector.

function editTrack(store: EditorStore, ops: OpInput[], label: string): void {
  const state = store.getState();
  if (state.canEdit && ops.length > 0) state.edit(ops, label);
}

export function addTrack(store: EditorStore, kind: TrackKind): void {
  editTrack(store, addTrackOps(store.getState().doc, kind), "add track");
}

export function renameTrack(store: EditorStore, trackId: string, name: string): void {
  editTrack(store, renameTrackOps(store.getState().doc, trackId, name), "rename track");
}

export function toggleTrack(store: EditorStore, trackId: string, field: TrackSwitch): void {
  editTrack(store, toggleTrackOps(store.getState().doc, trackId, field), "track change");
}

export function reorderTrack(store: EditorStore, trackId: string, direction: "up" | "down"): void {
  editTrack(store, reorderTrackOps(store.getState().doc, trackId, direction), "reorder tracks");
}

export function moveTrack(store: EditorStore, trackId: string, toRow: number): void {
  editTrack(store, moveTrackOps(store.getState().doc, trackId, toRow), "reorder tracks");
}

// Copies a track with its clips and selects the copy.
export function duplicateTrack(store: EditorStore, trackId: string): void {
  const state = store.getState();
  const newTrackId = nanoid(10);
  const ops = duplicateTrackOps(state.doc, trackId, newTrackId);
  if (!state.canEdit || ops.length === 0) return;
  if (state.edit(ops, "duplicate track").ok) state.selectTrack(newTrackId);
}

export function removeTrack(store: EditorStore, trackId: string): void {
  editTrack(store, removeTrackOps(store.getState().doc, trackId), "remove track");
}
