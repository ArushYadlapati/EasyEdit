import { METER_WIDTH, clampMeterWidth } from "@/lib/audio/meter";
import { nanoid } from "nanoid";
import { createStore, type StoreApi } from "zustand/vanilla";
import { LIMITS } from "@/lib/limits";
import {
  OpError,
  applyOps,
  docDuration,
  prepareOps,
  type Clip,
  type Op,
  type OpErrorCode,
  type OpInput,
  type TimelineDoc,
  type Track,
} from "@/lib/timeline";
import { canUndoChange, isBeforeMove } from "./activity";
import { clampZoom, fitZoom } from "./geometry";
import { MESSAGES, explainOpError } from "./messages";
import { shuttle as nextShuttle } from "./playback";
import { toolNeedsEdit, type Tool } from "./tools";
import type { BoxShape, LineTool } from "@/lib/timeline/shapes";
import { foldQueue, sameOps } from "./reconcile";
import type {
  ActivityEntry,
  EditKind,
  EditResult,
  EditorInit,
  Me,
  Notice,
  PendingEdit,
  Selection,
  SyncStatus,
  UndoEntry,
} from "./types";
import { ACTIVITY_LIMIT } from "./types";

export const UNDO_LIMIT = 100;
export { ACTIVITY_LIMIT };

export type EditorState = {
  projectId: string;
  name: string;
  me: Me;
  canEdit: boolean;
  // The project moved to another space while this tab was open. Nothing more is sent or fetched, and nothing can be
  // changed here: the edits still waiting stay on screen, unsent.
  moved: boolean;
  movedElsewhere: boolean; // moved, to a space this person is not in: there is nowhere to open it
  movedAtVersion: number | null; // the version the project's last move made, as the page loaded it; null: never moved
  server: { doc: TimelineDoc; version: number }; // what the server is known to hold
  queue: PendingEdit[]; // local edits not yet confirmed, oldest first
  doc: TimelineDoc; // server.doc with every queued edit applied
  gesture: { ops: Op[]; doc: TimelineDoc | null } | null; // a drag or a field being typed in; doc is null while it cannot apply
  selection: Selection;
  playhead: number;
  zoom: number; // pixels per frame
  viewportPx: number; // width of the timeline's scrolling area, without the track headers
  fitRequest: number; // counts zoomToFit calls, so the timeline knows to scroll to the start
  snapping: boolean;
  status: SyncStatus;
  notice: Notice | null;
  undoStack: UndoEntry[]; // newest last, at most UNDO_LIMIT
  redoStack: UndoEntry[];
  activity: ActivityEntry[]; // oldest first, at most ACTIVITY_LIMIT
  remote: { names: string[]; at: number } | null; // who else just edited, and when
  playing: boolean;
  rate: number; // negative when playing backward
  showSafeZones: boolean;
  viewAs: string | null; // the platform view drawn over the preview (platform-views.ts), or none
  // The clip whose next handle drag on the preview crops without Ctrl (the clip menu's Crop). Another selection, Play,
  // the clip's removal or the end of any drag on the preview clears it.
  cropArmed: string | null;
  // The text clip being typed in place on the preview. Its clip's removal, a lock or hide of its track, or the loss of
  // edit access clears it.
  textEditId: string | null;
  // The text opened for typing starts with all of it selected (new text from the Text tool), else with the caret at the end.
  textEditSelectAll: boolean;
  tool: Tool; // the rail's current tool, this person's own
  shapeTool: BoxShape; // the shape the Shape tool draws, this person's own; Rectangle when the editor opens
  lineTool: LineTool; // what the Line tool draws, a line or an arrow, this person's own; an arrow when the editor opens
  // The guide picked on the preview, this person's own. Picking a clip or a track clears it; so does its removal.
  guideId: string | null;
  showGuides: boolean; // this browser's choice, from View as
  showAudioMeter: boolean; // this browser's choice, from the View menu: the level meter beside the timeline
  audioMeterWidth: number; // px, this browser's choice, from dragging the meter's edge
  boardScale: number; // CSS pixels per project pixel on the preview as drawn now, so the zoom menu's Custom… starts there
  exporting: boolean; // an export is running in this tab
  exportHeld: boolean; // a finished export waits in this tab for its Download click

  edit(ops: OpInput[], label: string): EditResult;
  undo(): void;
  redo(): void;
  undoChange(entry: ActivityEntry): void; // "Undo this change" in the activity list
  loadActivity(entries: ActivityEntry[]): void; // merges a fetched page
  setGesture(ops: OpInput[] | null): boolean; // true when the gesture applies right now
  commitGesture(label: string): EditResult;
  select(clipIds: string[], mode?: "replace" | "toggle" | "add"): void;
  selectTrack(trackId: string | null): void;
  seek(frame: number): void; // rounds, never below 0
  setZoom(zoom: number): void;
  setViewport(px: number): void;
  zoomBy(factor: number): void; // zoom × factor, through clampZoom
  zoomToFit(): void; // the whole project in the viewport
  setSnapping(on: boolean): void;
  notify(tone: Notice["tone"], text: string, link?: Notice["link"]): void;
  dismissNotice(): void;
  // called by the sync engine
  markSent(editId: string, sent: boolean): void;
  ack(editId: string, version: number, inverse: Op[]): void;
  refuse(editId: string, code: OpErrorCode): void;
  applyRemote(entries: ActivityEntry[]): boolean; // false: an entry is missing or does not apply; the caller reloads
  replaceServer(doc: TimelineDoc, version: number): void;
  limitMessage: string | null; // why saving waits, while the status is "limited"
  setStatus(status: SyncStatus, limitMessage?: string): void;
  revokeEditing(): void;
  markMoved(elsewhere?: boolean): void; // the project moved to another space (elsewhere: one this person is not in): editing ends here, and the waiting edits are kept, unsent
  // playback, open to viewers too
  play(): void; // from the start when the playhead is at the end; not in a project with no clips
  pause(): void;
  shuttle(key: "j" | "k" | "l"): void;
  step(deltaFrames: number): void; // pauses, then moves the playhead; forward stops at the end
  toggleSafeZones(): void; // showing the safe area turns View as off
  setViewAs(id: string | null): void; // a platform view turns the safe area off
  setName(name: string): void; // only what the editor shows; renameFromEditor saves it
  setCropArmed(clipId: string | null): void;
  setShapeTool(shape: BoxShape): void;
  setLineTool(line: LineTool): void;
  setTool(tool: Tool): boolean; // false: a tool that changes the project, for someone who can't edit
  selectGuide(guideId: string | null): void; // clears the clip and track selection; a guide not there selects nothing
  setShowGuides(on: boolean): void; // hiding them clears the selected guide and leaves the Guide tool
  setShowAudioMeter(on: boolean): void;
  setAudioMeterWidth(px: number): void; // held within what the meter can be
  setBoardScale(k: number): void;
  setTextEdit(clipId: string | null, opts?: { selectAll?: boolean }): boolean; // false: a viewer, a missing clip, a locked or hidden track, not a text clip
  setExporting(on: boolean): void;
  setExportHeld(on: boolean): void;
};

export type EditorStore = StoreApi<EditorState>;

// The gesture's doc when it applies, else doc.
export function viewDoc(state: EditorState): TimelineDoc {
  return state.gesture?.doc ?? state.doc;
}

export function findClip(doc: TimelineDoc, clipId: string): { clip: Clip; track: Track } | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

// A text clip that can be typed in place: there, on a track neither locked nor hidden.
function typeableText(doc: TimelineDoc, clipId: string): boolean {
  const found = findClip(doc, clipId);
  return !!found && found.clip.type === "text" && !found.track.locked && !found.track.hidden;
}

function hasGuide(doc: TimelineDoc, guideId: string): boolean {
  return doc.guides?.some((g) => g.id === guideId) ?? false;
}

function clipIds(doc: TimelineDoc): Set<string> {
  return new Set(doc.tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

// Keeps only the clips and the track that still exist. Returns the same object when nothing went.
function pruneSelection(doc: TimelineDoc, selection: Selection): Selection {
  const existing = clipIds(doc);
  const kept = selection.clipIds.filter((id) => existing.has(id));
  const trackId = selection.trackId !== null && doc.tracks.some((t) => t.id === selection.trackId) ? selection.trackId : null;
  if (kept.length === selection.clipIds.length && trackId === selection.trackId) return selection;
  return { clipIds: kept, trackId };
}

type Stacks = Pick<EditorState, "undoStack" | "redoStack">;

function stacksOf(state: EditorState): Stacks {
  return { undoStack: state.undoStack, redoStack: state.redoStack };
}

// Forgets the history of edits that never happened (refused or dropped).
function withoutEdits(stacks: Stacks, editIds: string[]): Stacks {
  if (editIds.length === 0) return { undoStack: stacks.undoStack, redoStack: stacks.redoStack };
  const kept = (e: UndoEntry) => !editIds.includes(e.editId);
  return { undoStack: stacks.undoStack.filter(kept), redoStack: stacks.redoStack.filter(kept) };
}

// Once an edit is confirmed, undoing it sends the server's inverse instead of the local one.
function withServerInverse(stacks: Stacks, editId: string, inverse: Op[] | null): Stacks {
  if (inverse === null) return stacks;
  const swap = (e: UndoEntry) => (e.editId === editId ? { ...e, ops: inverse } : e);
  return { undoStack: stacks.undoStack.map(swap), redoStack: stacks.redoStack.map(swap) };
}

function pushCapped(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...stack, entry].slice(-UNDO_LIMIT);
}

// One entry per version, oldest first, keeping the newest ACTIVITY_LIMIT.
function mergeActivity(list: ActivityEntry[], added: ActivityEntry[]): ActivityEntry[] {
  if (added.length === 0) return list;
  const byVersion = new Map(list.map((e) => [e.version, e]));
  for (const e of added) byVersion.set(e.version, e);
  return [...byVersion.values()].sort((a, b) => a.version - b.version).slice(-ACTIVITY_LIMIT);
}

function refusalMessage(kind: EditKind, code: OpErrorCode): string {
  if (kind === "undo") return MESSAGES.undoRefused;
  if (kind === "redo") return MESSAGES.redoRefused;
  return explainOpError(code);
}

// Takes away the notice that asks the person to sign in again, when it is still the one showing. An error notice stays
// until it is dismissed or replaced, so this one has to go once it is no longer true.
function withoutSignedOutNotice(notice: Notice | null): { notice?: null } {
  return notice?.tone === "error" && notice.text === MESSAGES.signedOut ? { notice: null } : {};
}

// A request id names the edit exactly, so an entry from my other tab with the same ops is not
// taken for this tab's edit. Entries without one are matched on who made them and what they do.
function isOwnHead(entry: ActivityEntry, head: PendingEdit | undefined, meId: string): boolean {
  if (!head) return false;
  if (entry.requestId) return entry.requestId === head.id;
  return head.sent && entry.actor === meId && sameOps(entry.ops, head.ops);
}

export function createEditorStore(
  init: EditorInit,
  deps: {
    genId?: () => string;
    now?: () => number;
    view?: { snapping: boolean; showSafeZones: boolean; showGuides?: boolean; showAudioMeter?: boolean; audioMeterWidth?: number };
  } = {},
): EditorStore {
  // Edit ids are sent as request ids, which must be 8 to 64 characters of A-Za-z0-9_-.
  const genId = deps.genId ?? (() => nanoid(10));
  const now = deps.now ?? Date.now;
  let lastNoticeId = 0;
  const makeNotice = (tone: Notice["tone"], text: string, link?: Notice["link"]): Notice => ({ id: ++lastNoticeId, tone, text, ...(link && { link }) });

  return createStore<EditorState>()((set, get) => {
    // What follows a change to doc: the selection keeps only what still exists, and a live
    // gesture is re-applied. A gesture whose clip (or guide) is gone ends; one that no longer fits waits.
    function settle(state: EditorState, doc: TimelineDoc): Partial<EditorState> {
      const patch: Partial<EditorState> = { doc, selection: pruneSelection(doc, state.selection) };
      if (state.cropArmed !== null && !findClip(doc, state.cropArmed)) patch.cropArmed = null;
      if (state.textEditId !== null && !typeableText(doc, state.textEditId)) patch.textEditId = null;
      if (state.guideId !== null && !hasGuide(doc, state.guideId)) patch.guideId = null;
      const gesture = state.gesture;
      if (gesture) {
        try {
          patch.gesture = { ops: gesture.ops, doc: applyOps(doc, gesture.ops).doc };
        } catch (err) {
          if (err instanceof OpError && err.code === "NOT_FOUND") {
            patch.gesture = null;
            const guide = gesture.ops.every((op) => op.op === "add_guide" || op.op === "move_guide" || op.op === "remove_guide");
            patch.notice = makeNotice("error", guide ? MESSAGES.guideGone : MESSAGES.clipGone);
          } else {
            patch.gesture = { ops: gesture.ops, doc: null };
          }
        }
      }
      return patch;
    }

    // Shows a new server copy with the queue re-applied on top. Returns the edits that no longer
    // fit; their undo history goes with them.
    function rebase(
      state: EditorState,
      server: EditorState["server"],
      queue: PendingEdit[],
      stacks: Stacks = stacksOf(state),
    ) {
      const { doc, kept, dropped } = foldQueue(server.doc, queue);
      const history = withoutEdits(stacks, dropped.map((e) => e.id));
      return { patch: { server, queue: kept, ...history, ...settle(state, doc) }, dropped };
    }

    function rebaseAndTell(
      state: EditorState,
      server: EditorState["server"],
      queue: PendingEdit[],
      stacks: Stacks = stacksOf(state),
      extra: Partial<EditorState> = {},
    ) {
      const { patch, dropped } = rebase(state, server, queue, stacks);
      // A dropped undo or redo says what the server would say had it refused it.
      const first = dropped[0];
      const text = !first ? null : first.kind === "edit" ? MESSAGES.rebaseDropped : refusalMessage(first.kind, "STALE");
      const notice = text ? { notice: makeNotice("error", text) } : {};
      set({ ...patch, ...extra, ...notice });
    }

    // Undo and redo: replays the top entry of one stack as a new edit and puts its inverse on the
    // other. An entry that no longer applies is dropped with a notice.
    function replayTop(kind: "undo" | "redo") {
      const state = get();
      const source = kind === "undo" ? state.undoStack : state.redoStack;
      const top = source.at(-1);
      if (!state.canEdit || !top) return;
      const rest = source.slice(0, -1);
      const stacks = (pushed: UndoEntry | null): Stacks => {
        if (kind === "undo") return { undoStack: rest, redoStack: pushed ? pushCapped(state.redoStack, pushed) : state.redoStack };
        return { redoStack: rest, undoStack: pushed ? pushCapped(state.undoStack, pushed) : state.undoStack };
      };
      let result: { doc: TimelineDoc; inverse: Op[] };
      try {
        result = applyOps(state.doc, top.ops);
      } catch (err) {
        if (!(err instanceof OpError)) throw err;
        set({ ...stacks(null), notice: makeNotice("error", refusalMessage(kind, err.code)) });
        return;
      }
      if (result.inverse.length === 0) {
        set(stacks(null));
        return;
      }
      const pending: PendingEdit = { id: genId(), kind, label: top.label, ops: top.ops, inverse: result.inverse, sent: false };
      set({
        queue: [...state.queue, pending],
        ...stacks({ editId: pending.id, label: top.label, ops: result.inverse }),
        ...settle(state, result.doc),
      });
    }

    function fail(code: OpErrorCode, message: string): EditResult {
      set({ notice: makeNotice("error", message) });
      return { ok: false, code, message };
    }

    return {
      projectId: init.projectId,
      name: init.name,
      me: init.me,
      canEdit: init.canEdit,
      moved: false,
      movedElsewhere: false,
      movedAtVersion: init.movedAtVersion ?? null,
      server: { doc: init.doc, version: init.version },
      queue: [],
      doc: init.doc,
      gesture: null,
      selection: { clipIds: [], trackId: null },
      playhead: 0,
      zoom: 2,
      viewportPx: 1200,
      fitRequest: 0,
      snapping: deps.view?.snapping ?? true, // view: what this browser kept, which the caller read
      status: "saved",
      limitMessage: null,
      notice: null,
      undoStack: [],
      redoStack: [],
      activity: [],
      remote: null,
      playing: false,
      rate: 1,
      showSafeZones: deps.view?.showSafeZones ?? false,
      showGuides: deps.view?.showGuides ?? true,
      showAudioMeter: deps.view?.showAudioMeter ?? true,
      audioMeterWidth: clampMeterWidth(deps.view?.audioMeterWidth ?? METER_WIDTH.initial),
      tool: "select",
      shapeTool: "rect",
      lineTool: "arrow",
      guideId: null,
      boardScale: 1,
      viewAs: null,
      cropArmed: null,
      textEditId: null,
      textEditSelectAll: false,
      exporting: false,
      exportHeld: false,

      edit(ops, label) {
        const state = get();
        if (!state.canEdit) return { ok: false, code: "READ_ONLY", message: MESSAGES.readOnly };
        if (ops.length > LIMITS.opsPerRequest) return fail("LIMIT_EXCEEDED", MESSAGES.tooManyOps);
        let prepared: Op[];
        let result: { doc: TimelineDoc; inverse: Op[] };
        try {
          prepared = prepareOps(ops, genId);
          result = applyOps(state.doc, prepared);
        } catch (err) {
          if (err instanceof OpError) return fail(err.code, explainOpError(err.code));
          throw err;
        }
        if (result.inverse.length === 0) return { ok: true };
        const pending: PendingEdit = { id: genId(), kind: "edit", label, ops: prepared, inverse: result.inverse, sent: false };
        set({
          queue: [...state.queue, pending],
          undoStack: pushCapped(state.undoStack, { editId: pending.id, label, ops: result.inverse }),
          redoStack: [],
          ...settle(state, result.doc),
        });
        return { ok: true };
      },

      undo() {
        replayTop("undo");
      },

      redo() {
        replayTop("redo");
      },

      undoChange(entry) {
        const state = get();
        if (!state.canEdit || !canUndoChange(entry) || isBeforeMove(entry, state.movedAtVersion)) return;
        try {
          applyOps(state.doc, entry.inverse);
        } catch (err) {
          if (!(err instanceof OpError)) throw err;
          set({ notice: makeNotice("error", MESSAGES.undoRefused) });
          return;
        }
        get().edit(entry.inverse, "revert"); // the Undo button then reads "Undo revert"
      },

      loadActivity(entries) {
        const { activity } = get();
        const merged = mergeActivity(activity, entries);
        if (merged !== activity) set({ activity: merged });
      },

      setGesture(ops) {
        const state = get();
        if (!state.canEdit) return false;
        if (ops === null) {
          if (state.gesture) set({ gesture: null });
          return true;
        }
        let prepared: Op[];
        try {
          prepared = prepareOps(ops, genId);
        } catch (err) {
          if (!(err instanceof OpError)) throw err;
          set({ gesture: null });
          return false;
        }
        try {
          set({ gesture: { ops: prepared, doc: applyOps(state.doc, prepared).doc } });
          return true;
        } catch (err) {
          if (!(err instanceof OpError)) throw err;
          set({ gesture: { ops: prepared, doc: null } });
          return false;
        }
      },

      commitGesture(label) {
        const { gesture } = get();
        if (!gesture) return { ok: true };
        set({ gesture: null });
        return get().edit(gesture.ops, label);
      },

      select(ids, mode = "replace") {
        const state = get();
        const existing = clipIds(state.doc);
        const wanted = [...new Set(ids)].filter((id) => existing.has(id));
        const current = state.selection.clipIds;
        const added = wanted.filter((id) => !current.includes(id));
        let next: string[];
        if (mode === "replace") next = wanted;
        else if (mode === "add") next = [...current, ...added];
        else next = [...current.filter((id) => !wanted.includes(id)), ...added];
        const keepsArmed = next.length === 1 && next[0] === state.cropArmed;
        set({ selection: { clipIds: next, trackId: null }, guideId: null, ...(!keepsArmed && { cropArmed: null }) });
      },

      selectTrack(trackId) {
        if (trackId !== null && !get().doc.tracks.some((t) => t.id === trackId)) return;
        set({ selection: { clipIds: [], trackId }, guideId: null, cropArmed: null });
      },

      seek(frame) {
        if (!Number.isFinite(frame)) return;
        set({ playhead: Math.max(0, Math.round(frame)) });
      },

      setZoom(zoom) {
        set({ zoom });
      },

      setViewport(px) {
        if (px > 0 && Number.isFinite(px) && px !== get().viewportPx) set({ viewportPx: px });
      },

      zoomBy(factor) {
        const { zoom, doc } = get();
        set({ zoom: clampZoom(zoom * factor, docDuration(doc), doc.fps) });
      },

      zoomToFit() {
        const { doc, viewportPx } = get();
        set({ zoom: fitZoom(docDuration(doc), doc.fps, viewportPx), fitRequest: get().fitRequest + 1 });
      },

      setSnapping(on) {
        set({ snapping: on });
      },

      notify(tone, text, link) {
        set({ notice: makeNotice(tone, text, link) });
      },

      dismissNotice() {
        set({ notice: null });
      },

      markSent(editId, sent) {
        const { queue } = get();
        if (!queue.some((e) => e.id === editId && e.sent !== sent)) return;
        set({ queue: queue.map((e) => (e.id === editId ? { ...e, sent } : e)) });
      },

      ack(editId, version, inverse) {
        const state = get();
        const head = state.queue[0];
        if (!head || head.id !== editId) return;
        const fresh = version === state.server.version + 1;
        if (!fresh && version > state.server.version) return;
        const stacks = withServerInverse(stacksOf(state), editId, inverse);
        const logged: ActivityEntry = {
          version,
          ops: head.ops,
          inverse,
          actor: state.me.id,
          actorName: state.me.name,
          requestId: head.id,
          createdAt: new Date(now()).toISOString(),
        };
        const activity = mergeActivity(state.activity, [logged]);
        if (fresh) {
          // The server applied the head on exactly this copy, so doc already shows the result.
          set({
            server: { doc: applyOps(state.server.doc, head.ops).doc, version },
            queue: state.queue.slice(1),
            ...stacks,
            activity,
          });
        } else {
          // A replayed answer: the server copy already holds the head, so it only leaves the queue.
          rebaseAndTell(state, state.server, state.queue.slice(1), stacks, { activity });
        }
      },

      refuse(editId, code) {
        const state = get();
        const refused = state.queue.find((e) => e.id === editId);
        if (!refused) return;
        // Edits dropped because they depended on the refused one add no second notice.
        const { patch } = rebase(
          state,
          state.server,
          state.queue.filter((e) => e.id !== editId),
          withoutEdits(stacksOf(state), [editId]),
        );
        set({ ...patch, notice: makeNotice("error", refusalMessage(refused.kind, code)) });
      },

      applyRemote(entries) {
        const state = get();
        let server = state.server;
        let queue = state.queue;
        let stacks = stacksOf(state);
        const applied: ActivityEntry[] = [];
        let complete = true;
        for (const entry of [...entries].sort((a, b) => a.version - b.version)) {
          if (entry.version <= server.version) continue;
          if (entry.version !== server.version + 1) {
            complete = false;
            break;
          }
          let doc: TimelineDoc;
          try {
            doc = applyOps(server.doc, entry.ops).doc;
          } catch (err) {
            if (!(err instanceof OpError)) throw err;
            complete = false;
            break;
          }
          // My own edit coming back from the log: it is now part of the server copy.
          if (isOwnHead(entry, queue[0], state.me.id)) {
            stacks = withServerInverse(stacks, queue[0].id, entry.inverse);
            queue = queue.slice(1);
          }
          server = { doc, version: entry.version };
          applied.push(entry);
        }
        if (applied.length > 0) {
          // A change by an AI agent on my behalf has actor "claude:<my id>" or "agent:<kind>:<my id>", so it counts as someone else.
          const others = applied.filter((e) => e.actor !== state.me.id);
          const extra: Partial<EditorState> = { activity: mergeActivity(state.activity, applied) };
          if (others.length > 0) extra.remote = { names: [...new Set(others.map((e) => e.actorName))], at: now() };
          rebaseAndTell(state, server, queue, stacks, extra);
        }
        return complete;
      },

      replaceServer(doc, version) {
        const state = get();
        if (version < state.server.version) return;
        rebaseAndTell(state, { doc, version }, state.queue);
      },

      setStatus(status, limitMessage) {
        // Out of "signed-out", a request got past the sign-in check or failed for another reason, so the notice that
        // asks the person to sign in goes and doesn't sit under a top bar saying Saved. If they are still signed out,
        // the next refusal says so again.
        const leftSignedOut = get().status === "signed-out" && status !== "signed-out";
        set({ status, limitMessage: status === "limited" ? (limitMessage ?? null) : null, ...(leftSignedOut && withoutSignedOutNotice(get().notice)) });
      },

      revokeEditing() {
        const { server, selection } = get();
        set({
          canEdit: false,
          queue: [],
          gesture: null,
          doc: server.doc,
          selection: pruneSelection(server.doc, selection),
          cropArmed: null,
          textEditId: null,
          tool: "select",
          guideId: null,
          notice: makeNotice("error", MESSAGES.lostAccess),
        });
      },

      markMoved(elsewhere = false) {
        if (get().moved) return;
        // A notice asking the person to sign in to save goes too: nothing more is saved here, and the banner says why.
        set({
          moved: true, movedElsewhere: elsewhere, canEdit: false, gesture: null, cropArmed: null, textEditId: null, tool: "select", guideId: null,
          ...withoutSignedOutNotice(get().notice),
        });
      },

      play() {
        const { doc, playhead } = get();
        const end = docDuration(doc);
        if (end === 0) return;
        set({ playing: true, rate: 1, playhead: playhead >= end ? 0 : playhead, cropArmed: null });
      },

      pause() {
        set({ playing: false, rate: 1 });
      },

      shuttle(key) {
        const { doc, playhead, playing, rate } = get();
        const next = nextShuttle({ playing, rate }, key);
        if (!next.playing) {
          set(next);
          return;
        }
        const end = docDuration(doc);
        if (end === 0) return;
        const startsForward = next.rate > 0 && !(playing && rate > 0);
        set({ ...next, playhead: startsForward && playhead >= end ? 0 : playhead, cropArmed: null });
      },

      step(deltaFrames) {
        const { pause, seek, playhead, doc } = get();
        pause();
        const next = playhead + deltaFrames;
        // A playhead already past the end stays where it is rather than jumping back.
        seek(deltaFrames > 0 ? Math.min(next, Math.max(playhead, docDuration(doc))) : next);
      },

      toggleSafeZones() {
        const show = !get().showSafeZones;
        set(show ? { showSafeZones: true, viewAs: null } : { showSafeZones: false });
      },

      setViewAs(id) {
        set(id ? { viewAs: id, showSafeZones: false } : { viewAs: null });
      },

      setName(name) {
        set({ name });
      },

      setCropArmed(clipId) {
        if (clipId !== get().cropArmed) set({ cropArmed: clipId });
      },

      setShapeTool(shape) {
        if (shape !== get().shapeTool) set({ shapeTool: shape });
      },

      setLineTool(line) {
        if (line !== get().lineTool) set({ lineTool: line });
      },

      setTool(tool) {
        const state = get();
        if (toolNeedsEdit(tool) && !state.canEdit) return false;
        // The Guide tool shows the guides: a guide placed while they were hidden would be seen by everyone but its author.
        if (tool !== state.tool) set({ tool, ...(state.tool === "crop" && { cropArmed: null }), ...(tool === "guide" && { showGuides: true }) });
        return true;
      },

      selectGuide(guideId) {
        const state = get();
        if (guideId !== null && (!state.showGuides || !hasGuide(state.doc, guideId))) return;
        set({ guideId, selection: { clipIds: [], trackId: null }, cropArmed: null });
      },

      setBoardScale(k) {
        if (Number.isFinite(k) && k > 0 && k !== get().boardScale) set({ boardScale: k });
      },

      setShowGuides(on) {
        const state = get();
        if (on !== state.showGuides) set({ showGuides: on, ...(!on && { guideId: null, ...(state.tool === "guide" && { tool: "select" as const }) }) });
      },

      setShowAudioMeter(on) {
        if (on !== get().showAudioMeter) set({ showAudioMeter: on });
      },

      setAudioMeterWidth(px) {
        const width = clampMeterWidth(px);
        if (width !== get().audioMeterWidth) set({ audioMeterWidth: width });
      },

      setTextEdit(clipId, opts) {
        const state = get();
        if (clipId !== null && (!state.canEdit || !typeableText(state.doc, clipId))) return false;
        const selectAll = clipId !== null && opts?.selectAll === true;
        if (clipId !== state.textEditId || selectAll !== state.textEditSelectAll) set({ textEditId: clipId, textEditSelectAll: selectAll });
        return true;
      },

      setExporting(on) {
        if (on !== get().exporting) set({ exporting: on });
      },

      setExportHeld(on) {
        if (on !== get().exportHeld) set({ exportHeld: on });
      },
    };
  });
}
