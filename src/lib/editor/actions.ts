import { nanoid } from "nanoid";
import type { AssetView } from "@/lib/media/types";
import {
  DEFAULT_TRANSFORM,
  LOOKS,
  NO_CROP,
  lookOf,
  lookPatch,
  TRACK_ACCEPTS,
  isCropped,
  isPlaceholder,
  trackTakes,
  type Clip,
  type KeyframeProp,
  type OpInput,
  type TrackKind,
} from "@/lib/timeline";
import { fillSlots } from "@/lib/templates/fill";
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
  razorOps,
  splitOps,
  toggleTrackOps,
  type TrackSwitch,
} from "./commands";
import type { TimelinePoint } from "./geometry";
import { groupOps, ungroupOps } from "./groups";
import { clipFrame, kenBurnsOps, toggleKeyframeOps } from "./keyframe-edit";
import { neighbourMarker, toggleMarkerOps } from "./markers";
import { mediaClipFor, mediaLengthFrames } from "./media-clips";
import { MESSAGES, explainOpError } from "./messages";
import { placeClips } from "./placement";
import { duckOps, muteOps, separateAudioOps, soundClipsOf, volumeStepOps } from "./sound";
import { freezeFrameOps, reverseOps } from "./speed";
import { findClip, type EditorStore } from "./store";
import type { BrandFonts } from "@/lib/brand/types";
import { presetClip, type TextPreset } from "./text-presets";

// Puts a text preset at the playhead, on the selected text track when it has room, and selects it. The length in
// seconds is the caller's (Settings), else the default; the fonts are the space's brand kit's, else the default kit's.
export function addText(
  store: EditorStore,
  preset: TextPreset,
  seconds?: number,
  fonts?: BrandFonts,
  at?: { x: number; y: number },
): string | null {
  const state = store.getState();
  if (!state.canEdit) return null;
  const selected = state.doc.tracks.find((t) => t.id === state.selection.trackId);
  const trackId = selected?.kind === "text" ? selected.id : null;
  const clip = presetClip(preset, state.playhead, state.doc.fps, seconds, fonts);
  // at: where the Text tool was clicked, as shares of the frame, kept inside it.
  if (at) clip.transform = { ...clip.transform, x: Math.min(1, Math.max(0, at.x)), y: Math.min(1, Math.max(0, at.y)) };
  const placement = placeClips(state.doc, [{ clip, trackId }], () => nanoid(10));
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return null;
  }
  const result = state.edit(placement.ops, "add text");
  if (!result.ok) return null;
  state.select(placement.clipIds);
  return placement.clipIds[0] ?? null;
}

// Whether the clip is an empty slot that takes this asset: visual for a video or image, audio for audio.
export function placeholderTakes(clip: Clip | undefined, asset: AssetView): boolean {
  return !!clip && isPlaceholder(clip) && (clip.accepts === "audio") === (asset.kind === "audio");
}

// Puts a clip of a library asset at the frame given, else the playhead, and selects it unless select is false. The
// clip would like the track given (null: none), else the selected track when that track takes it; placeClips finds
// where it goes. A still image lasts stillSeconds (Settings), else the default; a video or audio clip runs to the end
// of its media. Returns whether the clip went in.
export function addMedia(
  store: EditorStore,
  asset: AssetView,
  opts: { frame?: number; trackId?: string | null; stillSeconds?: number; select?: boolean } = {},
): boolean {
  const state = store.getState();
  if (!state.canEdit) return false;
  // A click or a drop on the preview (no frame, no track) fills the selected slot when the asset fits it.
  if (opts.frame === undefined && opts.trackId === undefined && state.selection.clipIds.length === 1) {
    const picked = findClip(state.doc, state.selection.clipIds[0])?.clip;
    if (placeholderTakes(picked, asset)) return fillPlaceholder(store, picked!.id, asset);
  }
  // For video and audio durationSeconds would cap the length, so only an image is given one.
  const length = { durationSeconds: asset.kind === "image" ? opts.stillSeconds : undefined };
  const clip = asset.status === "ready" && !asset.removed ? mediaClipFor(asset, opts.frame ?? state.playhead, state.doc.fps, length) : null;
  if (!clip) {
    state.notify("info", MESSAGES.mediaNotReady);
    return false;
  }
  const selected = state.doc.tracks.find((t) => t.id === state.selection.trackId);
  const trackId = opts.trackId !== undefined ? opts.trackId : selected && TRACK_ACCEPTS[selected.kind].includes(clip.type) ? selected.id : null;
  // The id is a stand-in, as presetClip's is: placement gives the clip its real one.
  const placement = placeClips(state.doc, [{ clip: { ...clip, id: "new" }, trackId }], () => nanoid(10));
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return false;
  }
  const result = state.edit(placement.ops, "add media");
  if (result.ok && opts.select !== false) state.select(placement.clipIds);
  return result.ok;
}

// Fills the slot of the placeholder clip with a library asset, from the start of its footage, as one undoable change
// that keeps the clip's id. A kind the slot does not take shows fillSlots' message as a notice and changes nothing.
// Returns whether the slot was filled.
export function fillPlaceholder(store: EditorStore, clipId: string, asset: AssetView): boolean {
  const state = store.getState();
  if (!state.canEdit) return false;
  const clip = findClip(state.doc, clipId)?.clip;
  if (!clip || !isPlaceholder(clip)) return false;
  if (asset.status !== "ready" || asset.removed) {
    state.notify("info", MESSAGES.mediaNotReady);
    return false;
  }
  const durationFrames = mediaLengthFrames(asset, state.doc.fps) ?? null;
  const filled = fillSlots(state.doc, [{ slot: clip.slot.name, assetId: asset.id, inFrames: 0 }], new Map([[asset.id, { id: asset.id, kind: asset.kind, durationFrames }]]));
  if ("error" in filled) {
    state.notify("error", filled.error);
    return false;
  }
  const result = state.edit(filled.ops, "fill slot");
  if (!result.ok) {
    state.notify("error", result.message);
    return false;
  }
  state.select([clipId]);
  if (filled.short.length > 0) state.notify("info", MESSAGES.slotShort(clip.slot.name));
  return true;
}

// A brand kit logo's size: fitted inside the frame, then 40% of that, so a square logo is 432 px wide in a 1080-wide
// project. Arush's "medium".
export const LOGO_SCALE = 0.4;

// Puts a logo at the playhead on top of the video: on a free overlay track (a new one when none is free, never a
// video track), centred and medium sized, lasting stillSeconds (Settings), and selects it. Returns whether it went in.
export function addLogo(store: EditorStore, asset: AssetView, opts: { stillSeconds?: number } = {}): boolean {
  const state = store.getState();
  if (!state.canEdit) return false;
  const clip = asset.kind === "image" && asset.status === "ready" && !asset.removed ? mediaClipFor(asset, state.playhead, state.doc.fps, { durationSeconds: opts.stillSeconds }) : null;
  if (!clip) {
    state.notify("info", MESSAGES.mediaNotReady);
    return false;
  }
  const transform = { ...DEFAULT_TRANSFORM, fit: "contain" as const, scale: LOGO_SCALE };
  const placement = placeClips(state.doc, [{ clip: { ...clip, id: "new", transform }, trackId: null, kind: "overlay" }], () => nanoid(10));
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return false;
  }
  const result = state.edit(placement.ops, "add logo");
  if (result.ok) state.select(placement.clipIds);
  return result.ok;
}

// Sets every selected text clip and shape to the color, as one change: a shape's outline, or its fill when it has no
// outline. Clips on a locked track are left out, so the rest is not refused with them. With none selected it says how
// to use it; with only locked ones, that the track is locked.
export function recolorSelection(store: EditorStore, color: string): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const selected = state.selection.clipIds.flatMap((id) => {
    const found = findClip(state.doc, id);
    return found?.clip.type === "text" || found?.clip.type === "shape" ? [{ clip: found.clip, locked: found.track.locked }] : [];
  });
  const clips = selected.filter((t) => !t.locked).map((t) => t.clip);
  if (clips.length === 0) {
    if (selected.length > 0) state.notify("error", explainOpError("TRACK_LOCKED"));
    else state.notify("info", MESSAGES.selectTextToRecolor);
    return;
  }
  const ops: OpInput[] = clips.flatMap((c): OpInput[] => {
    if (c.type === "text") return c.style.color.toLowerCase() === color ? [] : [{ op: "update_clip", clipId: c.id, patch: { style: { color } } }];
    if (c.type !== "shape") return [];
    const field = c.stroke !== null ? "stroke" : "fill";
    return (c[field] ?? "").toLowerCase() === color ? [] : [{ op: "update_clip", clipId: c.id, patch: { [field]: color } }];
  });
  if (ops.length > 0) state.edit(ops, "style change");
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

// The Razor's click: cuts the clip at that frame. A frame on its edge, or a locked track, cuts nothing and says nothing.
export function splitClipAt(store: EditorStore, clipId: string, at: number): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const ops = razorOps(state.doc, clipId, at);
  if (ops.length > 0) state.edit(ops, "split");
}

// The selected clips, or with no clip selected the selected guide (a guide has no time, so ripple changes nothing).
export function deleteSelection(store: EditorStore, ripple: boolean): void {
  const state = store.getState();
  const ids = state.selection.clipIds;
  if (state.canEdit && ids.length === 0 && state.guideId !== null) {
    const result = state.edit([{ op: "remove_guide", guideId: state.guideId }], "remove guide");
    if (result.ok) state.selectGuide(null);
    return;
  }
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

// The selected clips that sound, for a volume command: none selected says how to use it, and only locked ones that the
// track is locked. Null when there is nothing to change.
function selectedSound(store: EditorStore): string[] | null {
  const state = store.getState();
  if (!state.canEdit) return null;
  const sounding = soundClipsOf(state.doc, state.selection.clipIds);
  if (sounding.length === 0) {
    state.notify("info", MESSAGES.selectSoundClip);
    return null;
  }
  if (sounding.every(({ track }) => track.locked)) {
    state.notify("error", explainOpError("TRACK_LOCKED"));
    return null;
  }
  return state.selection.clipIds;
}

// One step louder or quieter for the selected clips, as one change.
export function stepVolume(store: EditorStore, direction: 1 | -1): void {
  const ids = selectedSound(store);
  if (!ids) return;
  const ops = volumeStepOps(store.getState().doc, ids, direction);
  if (ops.length > 0) store.getState().edit(ops, "volume change");
}

// Silences the selected clips, or puts them back to as recorded when all of them are silent already.
export function toggleMute(store: EditorStore): void {
  const ids = selectedSound(store);
  if (!ids) return;
  const ops = muteOps(store.getState().doc, ids);
  if (ops.length > 0) store.getState().edit(ops, "volume change");
}

// Puts each selected video clip's sound on an audio clip of its own and selects those. hasSound: whether a file has
// sound at all, as the library knows it.
export function separateAudio(store: EditorStore, hasSound?: (assetId: string) => boolean): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const separated = separateAudioOps(state.doc, state.selection.clipIds, () => nanoid(10), hasSound);
  if (!separated.ok) {
    state.notify(separated.why === "room" ? "error" : "info", separated.why === "room" ? MESSAGES.noRoom : MESSAGES.nothingToSeparate);
    return;
  }
  if (state.edit(separated.ops, "separate audio").ok) state.select(separated.clipIds);
}

// Turns the selected clips down while other clips are heard over them: music under speech.
export function duckSelection(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const ducked = duckOps(state.doc, state.selection.clipIds);
  if (!ducked.ok) {
    state.notify("info", ducked.why === "nothing" ? MESSAGES.nothingToDuck : MESSAGES.nothingOver);
    return;
  }
  if (state.edit(ducked.ops, "duck").ok) state.notify("info", MESSAGES.ducked(ducked.clips));
}

// Turns the selected video clips round, so they play backward; a clip that already does plays forward again.
export function reverseSelection(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const ops = reverseOps(state.doc, state.selection.clipIds);
  if (ops.length === 0) state.notify("info", MESSAGES.nothingToReverse);
  else state.edit(ops, "reverse");
}

// Holds the frame under the playhead on the selected video clip for two seconds, and selects the held clip.
export function freezeFrame(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const frozen = freezeFrameOps(state.doc, state.selection.clipIds, state.playhead, () => nanoid(10));
  if (!frozen.ok) {
    state.notify("info", MESSAGES.nothingToFreeze);
    return;
  }
  if (state.edit(frozen.ops, "freeze frame").ok) state.select([frozen.clipId]);
}

// Gives a video or image a ready-made colour look, or with null takes its colours back to as recorded. Its blur stays.
export function applyLook(store: EditorStore, clipId: string, lookId: string | null): void {
  const state = store.getState();
  const clip = findClip(state.doc, clipId)?.clip;
  if (!state.canEdit || !clip || (clip.type !== "video" && clip.type !== "image")) return;
  const look = lookId === null ? null : (LOOKS.find((l) => l.id === lookId) ?? null);
  if (lookId !== null && !look) return;
  if (lookOf(clip.adjust) === (look?.id ?? "none")) return;
  state.edit([{ op: "update_clip", clipId, patch: { adjust: lookPatch(look) } }], "color look");
}

// Clips on locked tracks are left out, so a following delete or nudge is not refused as a whole.
export function selectAll(store: EditorStore): void {
  const state = store.getState();
  state.select(state.doc.tracks.flatMap((t) => (t.locked ? [] : t.clips.map((c) => c.id))));
}

// Links the selected clips, so the timeline selects and moves them as one.
export function groupSelection(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const ops = groupOps(state.doc, state.selection.clipIds, () => nanoid(10));
  if (!ops) state.notify("info", MESSAGES.nothingToGroup);
  else state.edit(ops, "link clips");
}

// Unlinks the selected clips.
export function ungroupSelection(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const ops = ungroupOps(state.doc, state.selection.clipIds);
  if (!ops) state.notify("info", MESSAGES.nothingToUngroup);
  else state.edit(ops, "unlink clips");
}

// Puts a marker at the playhead, or takes away the one there.
export function toggleMarker(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const { ops, added } = toggleMarkerOps(state.doc, state.playhead);
  state.edit(ops, added ? "add marker" : "remove marker");
}

// Moves the playhead to the nearest marker before or after it; with none that way it stays.
export function goToMarker(store: EditorStore, direction: "prev" | "next"): void {
  const state = store.getState();
  const at = neighbourMarker(state.doc, state.playhead, direction);
  if (at !== null) state.seek(at);
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
    return target && trackTakes(target.kind, item.clip) ? { ...item, trackId: target.id } : item;
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

// The inspector's diamond: adds a keyframe of the property at the playhead (inside the clip), or removes the one there,
// in one change. Nothing for a viewer or while a drag or a typed value is live.
export function toggleKeyframe(store: EditorStore, clipId: string, prop: KeyframeProp): void {
  const state = store.getState();
  const clip = findClip(state.doc, clipId)?.clip;
  if (!state.canEdit || state.gesture !== null || !clip) return;
  // Only a clip that sounds has a volume to key, and an audio clip has nothing else.
  const sounds = clip.type === "video" || clip.type === "audio";
  if (prop === "volume" ? !sounds : clip.type === "audio") return;
  state.edit(toggleKeyframeOps(clip, prop, clipFrame(clip, state.playhead)), "keyframe");
}

// Keys an image's scale for a slow push in across the clip, in one change.
export function kenBurns(store: EditorStore, clipId: string): void {
  const state = store.getState();
  const clip = findClip(state.doc, clipId)?.clip;
  if (!state.canEdit || state.gesture !== null || clip?.type !== "image") return;
  state.edit(kenBurnsOps(clip), "keyframe");
}

// Pauses, moves the playhead to the clip's start when it is outside the clip, and makes the clip the selection.
function focusClip(store: EditorStore, clipId: string): void {
  const state = store.getState();
  const clip = findClip(state.doc, clipId)?.clip;
  if (!clip) return;
  state.pause();
  if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) state.seek(clip.start);
  state.select([clipId]);
}

// The clip menu's Crop: shows the clip with its crop marks, and its next handle drag on the preview crops without Ctrl.
// A notice says Alt (Option on a Mac) does it any time. Nothing for a viewer, while a drag or a typed value is live, or
// for audio or a clip on a locked track. On a hidden track it says so instead.
export function armCrop(store: EditorStore, clipId: string, isMac: boolean): void {
  const state = store.getState();
  const found = findClip(state.doc, clipId);
  if (!state.canEdit || state.gesture !== null || !found || found.track.locked || found.clip.type === "audio" || (found.clip.type === "placeholder" && found.clip.accepts === "audio")) return;
  if (found.track.hidden) {
    state.notify("error", MESSAGES.trackHidden);
    return;
  }
  focusClip(store, clipId);
  store.getState().setCropArmed(clipId);
  store.getState().notify("info", isMac ? MESSAGES.cropHintMac : MESSAGES.cropHint);
}

// Opens a text clip for typing in place on the preview: pauses, brings the playhead into the clip and selects it. On a
// locked or hidden track it says so instead. Nothing for a viewer, or while a drag or a typed value is live.
export function editTextInPlace(store: EditorStore, clipId: string, opts?: { selectAll?: boolean }): void {
  const state = store.getState();
  const found = findClip(state.doc, clipId);
  if (!state.canEdit || !found || found.clip.type !== "text" || state.gesture !== null) return;
  if (found.track.locked) {
    state.notify("error", explainOpError("TRACK_LOCKED"));
    return;
  }
  if (found.track.hidden) {
    state.notify("error", MESSAGES.trackHidden);
    return;
  }
  focusClip(store, clipId);
  store.getState().setTextEdit(clipId, opts);
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
