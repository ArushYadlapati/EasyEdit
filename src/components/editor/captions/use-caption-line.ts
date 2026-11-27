"use client";

import { useEffect, useRef, useState } from "react";
import { retextOps } from "@/lib/captions/actions";
import { findCue, type CueKey } from "@/lib/captions/cues";
import type { EditorStore } from "@/lib/editor/store";
import type { Op } from "@/lib/timeline";

export const CAPTION_EDIT_LABEL = "edit caption";
export const CAPTION_CHANGED = "That caption changed while you were typing. Try again.";

// One caption line being retyped, wherever its box is (the preview's in-place box, the inspector, the Captions tab).
// What is typed shows at once as a held edit (held-edit.ts): unsaved until a pause in typing, the end of the edit or the
// page going away saves it, one change each time. Each keystroke is made against the line as the project has it now,
// found again by its key, so a pause that saved the first words lets the typing go on. save ends the edit, keeping what
// was typed (or says it can't, when the words changed under it); cancel drops what is not saved yet. A box that goes
// away mid-edit saves. shown: the line's text when
// nothing is being typed.
export function useCaptionLine(store: EditorStore, key: CueKey, shown: string) {
  const [draft, setDraft] = useState<string | null>(null);
  const own = useRef<Op[] | null>(null); // the held edit this box made, so it never saves or drops another's

  const holds = () => own.current !== null && store.getState().gesture?.ops === own.current;

  function change(text: string) {
    setDraft(text);
    const state = store.getState();
    const cue = findCue(state.doc, key);
    const ops = cue ? retextOps(state.doc, cue, text) : [];
    if (ops.length === 0) {
      // Back to what the project says: nothing to hold.
      if (holds()) state.setGesture(null);
      own.current = null;
      return;
    }
    state.setGesture(ops, CAPTION_EDIT_LABEL);
    own.current = store.getState().gesture?.ops ?? null;
  }

  // What was typed no longer fits (a teammate changed those words first): it is dropped, and the line shows theirs.
  function save() {
    setDraft(null);
    if (holds()) {
      const state = store.getState();
      if (state.gesture?.doc === null) {
        state.setGesture(null);
        state.notify("info", CAPTION_CHANGED);
      } else state.commitGesture(CAPTION_EDIT_LABEL);
    }
    own.current = null;
  }

  function cancel() {
    setDraft(null);
    if (holds()) store.getState().setGesture(null);
    own.current = null;
  }

  // Gone mid-edit (the selection moved on, the box closed): what was typed is kept.
  useEffect(
    () => () => {
      if (own.current !== null && store.getState().gesture?.ops === own.current) store.getState().commitGesture(CAPTION_EDIT_LABEL);
      own.current = null;
    },
    [store],
  );

  return { value: draft ?? shown, editing: draft !== null, change, save, cancel };
}
