import { LIMITS } from "@/lib/limits";
import { docDuration, isCropped, isNest, type MediaClip, type TrackKind } from "@/lib/timeline";
import { addAdjustmentOps } from "./adjustment";
import { duplicateTrackOps, reorderTrackOps, splitOps } from "./commands";
import { soundClipsOf } from "./sound";
import { nestOps } from "./nest";
import { freezeFrameOps, reverseOps } from "./speed";
import { trackToggles, zoomLimits } from "./geometry";
import { SHORTCUTS, type CommandId } from "./shortcuts";
import { findClip, type EditorState } from "./store";

// One entry of a menu, as data. command: the shortcut-table command it runs, whose key is shown as
// its hint. edit: it changes the project, so its control is marked as an edit control.
export type MenuEntry = {
  id: string;
  label: string;
  command?: CommandId;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  edit?: boolean;
};

// What the Edit and View menus need to know, read when one opens.
export type TopMenuInput = {
  canEdit: boolean;
  deleted: boolean;
  busy: boolean; // a drag or a field being typed in
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  snapping: boolean;
  showSafeZones: boolean;
  showAudioMeter: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
};

const EDITS = new Set(SHORTCUTS.filter((s) => s.edits).map((s) => s.command));

export function topMenuInput(state: EditorState, canPaste: boolean): TopMenuInput {
  const { min, max } = zoomLimits(docDuration(state.doc), state.doc.fps);
  return {
    canEdit: state.canEdit,
    deleted: state.status === "deleted",
    busy: state.gesture !== null,
    hasSelection: state.selection.clipIds.length > 0,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    canPaste,
    snapping: state.snapping,
    showSafeZones: state.showSafeZones,
    showAudioMeter: state.showAudioMeter,
    canZoomIn: state.zoom < max,
    canZoomOut: state.zoom > min,
  };
}

type CommandEntry = { command: CommandId; label: string; separatorBefore?: boolean; unavailable?: boolean };

// A command's entry. One that changes the project is also greyed when the person cannot edit right
// now (a viewer, a deleted project, a drag in progress), as runCommand would ignore it.
function commandEntry(input: TopMenuInput, { command, label, separatorBefore, unavailable = false }: CommandEntry): MenuEntry {
  const edit = EDITS.has(command);
  const blocked = edit && (!input.canEdit || input.deleted || input.busy);
  return {
    id: command,
    label,
    command,
    disabled: blocked || unavailable,
    ...(separatorBefore && { separatorBefore }),
    ...(edit && { edit }),
  };
}

export function editMenu(input: TopMenuInput): MenuEntry[] {
  const noSelection = !input.hasSelection;
  const entries: CommandEntry[] = [
    { command: "undo", label: "Undo", unavailable: !input.canUndo },
    { command: "redo", label: "Redo", unavailable: !input.canRedo },
    { command: "cut", label: "Cut", separatorBefore: true, unavailable: noSelection },
    { command: "copy", label: "Copy", unavailable: noSelection },
    { command: "paste", label: "Paste", unavailable: !input.canPaste },
    { command: "duplicate", label: "Duplicate", unavailable: noSelection },
    { command: "split", label: "Split", separatorBefore: true },
    { command: "delete", label: "Delete", unavailable: noSelection },
    { command: "ripple-delete", label: "Ripple delete", unavailable: noSelection },
    { command: "select-all", label: "Select all", separatorBefore: true },
    { command: "clear-selection", label: "Deselect all" },
  ];
  const items = entries.map((entry) => commandEntry(input, entry));
  // Not a command: the top bar opens the Save as template dialog by id. Left out for anyone who cannot edit.
  if (input.canEdit && !input.deleted) {
    items.push({ id: "save-template", label: "Save as template…", separatorBefore: true, edit: true, disabled: input.busy });
  }
  // A cut from, or for, another editor (Premiere Pro, DaVinci Resolve): the top bar opens each dialog by id. Writing
  // one out changes nothing, so a viewer has it too.
  if (!input.deleted) {
    if (input.canEdit) items.push({ id: "import-timeline", label: "Import timeline…", separatorBefore: true, edit: true, disabled: input.busy });
    items.push({ id: "export-timeline", label: "Export timeline…", ...(!input.canEdit && { separatorBefore: true }) });
  }
  return items;
}

// The zoom entries name the timeline, so neither reads as the preview's zoom. Safe area and Reset
// panel sizes are not commands: the top bar handles them by id.
export function viewMenu(input: TopMenuInput): MenuEntry[] {
  return [
    commandEntry(input, { command: "zoom-in", label: "Zoom in on the timeline", unavailable: !input.canZoomIn }),
    commandEntry(input, { command: "zoom-out", label: "Zoom out on the timeline", unavailable: !input.canZoomOut }),
    commandEntry(input, { command: "zoom-fit", label: "Fit the timeline" }),
    { ...commandEntry(input, { command: "toggle-snapping", label: "Snapping", separatorBefore: true }), checked: input.snapping },
    { id: "safe-zones", label: "Safe area", checked: input.showSafeZones },
    { ...commandEntry(input, { command: "toggle-audio-meter", label: "Audio meter" }), checked: input.showAudioMeter },
    { id: "reset-layout", label: "Reset panel sizes", separatorBefore: true },
    commandEntry(input, { command: "show-shortcuts", label: "Keyboard shortcuts" }),
  ];
}

// A lesson of the guide, as the editor knows it: its name, its page, and the names of its chapters (for the search).
// The editor is handed these when the server has the guide, and none when it has not.
export type GuideLink = { title: string; path: string; chapters: readonly string[] };

// An entry that opens a lesson: "guide:" and the lesson's place in the list.
export const guideEntryId = (index: number) => `guide:${index}`;
export function guideLinkOf(id: string, guide: readonly GuideLink[]): GuideLink | undefined {
  const match = /^guide:(\d+)$/.exec(id);
  return match ? guide[Number(match[1])] : undefined;
}

// Help: the guide's lessons by name, each opening on the Learn page in a tab of its own so the project stays open,
// then the keyboard shortcuts. The top bar shows the menu only when there are lessons to list.
export function helpMenu(input: TopMenuInput, guide: readonly GuideLink[]): MenuEntry[] {
  return [
    ...guide.map((lesson, index) => ({ id: guideEntryId(index), label: lesson.title })),
    commandEntry(input, { command: "show-shortcuts", label: "Keyboard shortcuts", separatorBefore: guide.length > 0 }),
  ];
}

export type TrackMenuId = "rename" | "duplicate" | "up" | "down" | "locked" | "hidden" | "muted" | "remove";

// A track's options (label "Track options"), read when the menu opens. Every entry changes the
// project, so all are greyed for a viewer.
export function trackMenu(state: EditorState, trackId: string): MenuEntry[] {
  const { doc, canEdit } = state;
  const track = doc.tracks.find((t) => t.id === trackId);
  const locked = track?.locked ?? false;
  const toggles = track ? trackToggles(track.kind) : [];
  const entry = (id: TrackMenuId, label: string, unavailable = false): MenuEntry => ({
    id,
    label,
    disabled: !canEdit || unavailable,
    edit: true,
  });
  return [
    entry("rename", "Rename"),
    entry("duplicate", "Duplicate", duplicateTrackOps(doc, trackId, "new").length === 0),
    entry("up", "Move up", reorderTrackOps(doc, trackId, "up").length === 0),
    entry("down", "Move down", reorderTrackOps(doc, trackId, "down").length === 0),
    // The header's switches, here too: a phone's narrow header shows only the name and this menu.
    { ...entry("locked", locked ? "Unlock track" : "Lock track"), separatorBefore: true },
    ...(toggles.includes("hidden") ? [entry("hidden", track?.hidden ? "Show track" : "Hide track")] : []),
    ...(toggles.includes("muted") ? [entry("muted", track?.muted ? "Unmute track" : "Mute track")] : []),
    {
      ...entry("remove", locked ? "Remove track (unlock first)" : "Remove track", locked),
      danger: true,
      separatorBefore: true,
    },
  ];
}

// A right-click menu as a viewer may use it: what changes the project is left out, and the first
// entry left has no separator above it. An editor's is unchanged.
export function rightClickEntries(entries: MenuEntry[], canEdit: boolean): MenuEntry[] {
  const kept = canEdit ? entries : entries.filter((e) => !e.edit);
  return kept.map((entry, i) => {
    if (i > 0 || !entry.separatorBefore) return entry;
    const { separatorBefore, ...rest } = entry;
    void separatorBefore;
    return rest;
  });
}

// Nothing that changes the project runs for a viewer, in a deleted project, or in the middle of a drag.
export function editBlocked(state: EditorState): boolean {
  return !state.canEdit || state.status === "deleted" || state.gesture !== null;
}

export type ClipMenuId =
  | "cut" | "copy" | "duplicate" | "split" | "edit-text" | "crop" | "reset-crop" | "mute-clip" | "separate-audio" | "reverse-clip" | "freeze-frame"
  | "group-clips" | "ungroup-clips" | "nest" | "unnest" | "delete";

// A clip's menu (label "Clip actions"), for the selection the right-click made. Cut and Delete are
// greyed when a selected clip is on a locked track, Split when the playhead crosses none of the
// selection on an unlocked track. Duplicate also works from a locked track: the copies go elsewhere.
// Edit text is there for one text clip, and Crop and Reset crop for one video, image or text clip, all greyed on a
// locked track and Reset crop also when it is not cropped; none is a command, so the menu's opener runs them. With a
// video or audio clip selected there are Mute (Unmute when all of them are silent) and, for a video that still has its
// sound, Separate audio. With a video clip selected there are Reverse (Play forward when all of them play backward) and
// Freeze frame, greyed when the playhead is on none of them. Unlink clips is there when one of them is linked (a video
// and the sound Separate audio took from it are), Link clips for two or more that are not one group already.
export function clipMenu(state: EditorState): MenuEntry[] {
  const { doc, selection, playhead } = state;
  const selected = new Set(selection.clipIds);
  const onLocked = doc.tracks.some((t) => t.locked && t.clips.some((c) => selected.has(c.id)));
  const blocked = editBlocked(state);
  const entry = (command: Extract<ClipMenuId, CommandId>, label: string, unavailable: boolean, extra: Partial<MenuEntry> = {}): MenuEntry => {
    const edit = EDITS.has(command);
    return { id: command, label, command, disabled: (edit && blocked) || unavailable, ...extra, ...(edit && { edit }) };
  };
  const single = selection.clipIds.length === 1 ? (findClip(doc, selection.clipIds[0])?.clip ?? null) : null;
  const croppable = single !== null && single.type !== "audio" && !(single.type === "placeholder" && single.accepts === "audio");
  const typeable = single !== null && single.type === "text";
  const sounding = soundClipsOf(doc, selection.clipIds);
  const audible = sounding.some(({ clip }) => clip.volume > 0);
  const separable = sounding.some(({ clip, track }) => clip.type === "video" && clip.volume > 0 && !track.locked);
  const allLocked = sounding.every(({ track }) => track.locked);
  const videos = doc.tracks.flatMap((t) => t.clips.filter((c) => selected.has(c.id) && c.type === "video")) as MediaClip[];
  const picked = doc.tracks.flatMap((t) => t.clips.filter((c) => selected.has(c.id)));
  const linked = picked.some((clip) => !!clip.group);
  const linkable = picked.length >= 2 && !(picked[0].group && picked.every((clip) => clip.group === picked[0].group));
  return [
    entry("cut", "Cut", onLocked),
    entry("copy", "Copy", false),
    entry("duplicate", "Duplicate", false, { separatorBefore: true }),
    entry("split", "Split at the playhead", splitOps(doc, playhead, selection.clipIds).length === 0, { separatorBefore: true }),
    ...(typeable ? [{ id: "edit-text", label: "Edit text", disabled: blocked || onLocked, edit: true }] : []),
    ...(croppable
      ? [
          { id: "crop", label: "Crop", disabled: blocked || onLocked, edit: true },
          { id: "reset-crop", label: "Reset crop", disabled: blocked || onLocked || !isCropped(single.transform.crop), edit: true },
        ]
      : []),
    ...(sounding.length > 0
      ? [
          entry("mute-clip", audible ? "Mute" : "Unmute", allLocked, { separatorBefore: true }),
          ...(sounding.some(({ clip }) => clip.type === "video") ? [entry("separate-audio", "Separate audio", !separable)] : []),
        ]
      : []),
    ...(videos.length > 0
      ? [
          entry("reverse-clip", videos.every((clip) => clip.speed < 0) ? "Play forward" : "Reverse", reverseOps(doc, selection.clipIds).length === 0, { separatorBefore: true }),
          entry("freeze-frame", "Freeze frame", !freezeFrameOps(doc, selection.clipIds, playhead, () => "").ok),
        ]
      : []),
    ...(linkable ? [entry("group-clips", "Link clips", onLocked, { separatorBefore: true })] : []),
    ...(linked ? [entry("ungroup-clips", "Unlink clips", onLocked, { separatorBefore: !linkable })] : []),
    // Several clips made one, which is then placed, faded and graded as a whole; and a nest taken apart again.
    ...(single !== null && isNest(single)
      ? [{ id: "unnest", label: "Unnest", disabled: blocked || onLocked, edit: true, separatorBefore: !linkable && !linked }]
      : [{ id: "nest", label: selection.clipIds.length === 1 ? "Nest" : "Nest clips", disabled: blocked || onLocked || !nestOps(doc, selection.clipIds, () => "").ok, edit: true, separatorBefore: !linkable && !linked }]),
    entry("delete", "Delete", onLocked, { separatorBefore: true, danger: true }),
  ];
}

export type LaneMenuId = "paste" | "track-duplicate" | "track-remove" | "adjustment-layer" | "add-video" | "add-overlay" | "add-text" | "add-audio" | "add-caption" | "add-shape";

const ADDABLE: { kind: TrackKind; label: string }[] = [
  { kind: "video", label: "Add video track" },
  { kind: "overlay", label: "Add overlay track" },
  { kind: "text", label: "Add text track" },
  { kind: "shape", label: "Add shapes track" },
  { kind: "audio", label: "Add audio track" },
  { kind: "caption", label: "Add captions track" },
];

// The menu of a track's empty row, or of the space below the last row when trackId is null (label
// "Timeline"). Every entry changes the project. A project has one captions track at most, and 20
// tracks at most.
export function laneMenu(state: EditorState, canPaste: boolean, trackId: string | null): MenuEntry[] {
  const { doc } = state;
  const blocked = editBlocked(state);
  const track = doc.tracks.find((t) => t.id === trackId);
  const entry = (id: LaneMenuId, label: string, unavailable: boolean, extra: Partial<MenuEntry> = {}): MenuEntry => ({
    id,
    label,
    disabled: blocked || unavailable,
    ...extra,
    edit: true,
  });
  const entries = [entry("paste", "Paste", !canPaste)];
  if (track) {
    entries.push(
      entry("track-duplicate", "Duplicate track", duplicateTrackOps(doc, track.id, "new").length === 0, { separatorBefore: true }),
      entry("track-remove", track.locked ? "Remove track (unlock first)" : "Remove track", track.locked, { danger: true }),
    );
  }
  const full = doc.tracks.length >= LIMITS.tracksPerProject;
  const hasCaptions = doc.tracks.some((t) => t.kind === "caption");
  const adds = ADDABLE.filter(({ kind }) => kind !== "caption" || !hasCaptions);
  adds.forEach(({ kind, label }, i) => entries.push(entry(`add-${kind}`, label, full, i === 0 ? { separatorBefore: true } : {})));
  // An adjustment layer goes in at the playhead, in front of every picture: on the top picture track, or a new one.
  entries.push(entry("adjustment-layer", "Add adjustment layer", !addAdjustmentOps(doc, state.playhead, { clip: "new", track: "new" }).ok, { separatorBefore: true }));
  return entries;
}

export type PreviewMenuId = "paste" | "safe-zones";

// The menu of the preview where no clip takes the right-click, or a clip on a locked track does (label "Preview").
// Paste runs the paste command, at the playhead. Safe area is this browser's switch, so a viewer keeps it.
export function previewMenu(state: EditorState, canPaste: boolean): MenuEntry[] {
  return [
    { id: "paste", label: "Paste", command: "paste", disabled: editBlocked(state) || !canPaste, edit: true },
    { id: "safe-zones", label: "Safe area", checked: state.showSafeZones, separatorBefore: true },
  ] satisfies (MenuEntry & { id: PreviewMenuId })[];
}

export type AssetMenuId = "add" | "monitor" | "rename" | "event" | "remove";

// A media tile's menu (label "More for <name>").
export function assetMenu(): MenuEntry[] {
  return [
    { id: "add", label: "Add to timeline", edit: true },
    // Opens the file on its own, to mark a part of it and insert or overwrite that at the playhead.
    { id: "monitor", label: "Open in source monitor", edit: true },
    { id: "rename", label: "Rename", separatorBefore: true, edit: true },
    { id: "event", label: "Set event", edit: true },
    { id: "remove", label: "Remove", danger: true, edit: true },
  ] satisfies (MenuEntry & { id: AssetMenuId })[];
}

export type PresetMenuId = "add";

// A Text-tab preset's menu (label "More for <preset label>").
export function presetMenu(): MenuEntry[] {
  return [{ id: "add", label: "Add to timeline", edit: true }] satisfies (MenuEntry & { id: PresetMenuId })[];
}
