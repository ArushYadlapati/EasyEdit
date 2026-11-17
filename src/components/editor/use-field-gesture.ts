"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Sizer } from "@/lib/editor/clip-box";
import { FIELD_LABEL, clipFieldOps, fieldContext, type ClipField, type FieldPrefs } from "@/lib/editor/inspector-fields";
import { mediaLengthFrames } from "@/lib/editor/media-clips";
import { explainOpError } from "@/lib/editor/messages";
import { findClip, type EditorStore } from "@/lib/editor/store";
import type { LibraryStore } from "@/lib/media/library-store";
import type { Op, OpInput } from "@/lib/timeline";

// What a number field shows and changes against besides the document: this browser's unit and lock, and how the
// clip's box is measured.
export type FieldView = { prefs: FieldPrefs; sizer: Sizer };

// The ops that set a field of the clip as the store holds it now (not as a live gesture shows it):
// null when the input is not valid, [] when it changes nothing. A media clip's length stops where its media ends,
// as far as the library knows it now. Without a view, the field is read in pixels with no box. A keyframed property is
// keyed at the playhead.
export function fieldOps(store: EditorStore, clipId: string, field: ClipField, raw: string, library?: LibraryStore, view?: FieldView) {
  const { doc, playhead } = store.getState();
  const found = findClip(doc, clipId);
  if (!found) return null;
  const { clip } = found;
  const lengthFrames = clip.type === "text" || !library ? undefined : mediaLengthFrames(library.getState().assets[clip.assetId], doc.fps);
  return clipFieldOps(clip, field, raw, fieldContext(doc, clip, view?.prefs, view?.sizer, playhead), lengthFrames);
}

// Ends a field's edit the way leaving it does. The field's own live gesture is saved as one change;
// the store refuses one that does not apply, with its own message. A value that could not be turned
// into a change is reported, unless the clip is gone. Anything else (no draft, or a gesture the
// store already ended) is nothing to do.
export function finishField(store: EditorStore, clipId: string, field: ClipField, own: Op[] | null, refused: boolean) {
  const state = store.getState();
  if (own !== null && state.gesture?.ops === own) state.commitGesture(FIELD_LABEL[field]);
  else if (refused && findClip(state.doc, clipId)) state.notify("error", explainOpError("INVALID"));
}

// One field's live gesture: the ops it last previewed (as the store holds them, so a gesture this
// field did not start is never saved under its label) and whether that preview was refused. When
// the field goes away mid-edit, for example because the selection changed before it lost focus,
// the edit is finished as if the field had been left. preview returns whether the change applies right now: false
// for ops that are not valid or a change the store refuses.
export function useFieldGesture(store: EditorStore, clipId: string, field: ClipField) {
  const own = useRef<Op[] | null>(null);
  const refused = useRef(false);
  const [live, setLive] = useState<Op[] | null>(null); // own, for rendering

  function remember(ops: Op[] | null, wasRefused: boolean) {
    own.current = ops;
    refused.current = wasRefused;
    setLive(ops);
  }

  useEffect(() => () => finishField(store, clipId, field, own.current, refused.current), [store, clipId, field]);

  return {
    live,
    preview(ops: OpInput[] | null): boolean {
      const change = ops !== null && ops.length > 0 ? ops : null;
      const applies = store.getState().setGesture(change);
      remember(change ? (store.getState().gesture?.ops ?? null) : null, ops === null || !applies);
      return ops !== null && applies;
    },
    finish() {
      finishField(store, clipId, field, own.current, refused.current);
      remember(null, false);
    },
    drop() {
      const state = store.getState();
      if (own.current !== null && state.gesture?.ops === own.current) state.setGesture(null);
      remember(null, false);
    },
  };
}

// How a text field's keys end an edit. escapeSaves: Escape saves what was typed instead of putting the value back.
// enterAddsLine: a plain Enter (or Shift+Enter) is left to the field, which adds a line, and Cmd/Ctrl+Enter saves.
export type TextFieldKeys = { escapeSaves?: boolean; enterAddsLine?: boolean };

// A typed text field of the clip. What was typed is kept as a draft and previewed; blur or Enter
// saves it and Escape drops it, unless opts say otherwise. A refused value is reported on save, and the field then
// shows the document's value again. onKeyDown returns whether the key ended the edit.
export function useTextField(store: EditorStore, clipId: string, field: ClipField, shown: string, opts: TextFieldKeys = {}) {
  const [draft, setDraft] = useState<string | null>(null);
  const gesture = useFieldGesture(store, clipId, field);

  function change(raw: string) {
    setDraft(raw);
    gesture.preview(fieldOps(store, clipId, field, raw));
  }

  function save() {
    if (draft === null) return;
    setDraft(null);
    gesture.finish();
  }

  // Returns whether there was a draft to drop.
  function cancel(): boolean {
    if (draft === null) return false;
    setDraft(null);
    gesture.drop();
    return true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, multiline = false): boolean {
    if (event.nativeEvent.isComposing) return false;
    if (event.key === "Enter") {
      const newLine = opts.enterAddsLine ? !(event.metaKey || event.ctrlKey) : multiline && event.shiftKey;
      if (newLine) return false;
      event.preventDefault();
      save();
      return true;
    }
    if (event.key === "Escape") {
      if (opts.escapeSaves) {
        event.preventDefault();
        save();
        return true;
      }
      if (cancel()) {
        event.preventDefault();
        return true;
      }
    }
    return false;
  }

  return { value: draft ?? shown, change, save, onKeyDown };
}
