import type { EditorState, EditorStore } from "./store";

// A held edit is a live edit that stays open without a pointer held down: words typed in a field, a number being typed,
// the colour picker moving, a wheel or curve being dragged. The screen shows it at once; nothing is sent until it is
// saved. It counts as unsaved (the top bar says so and the browser asks before leaving), and it is saved after this
// long without a change, when the tab is hidden, and when the page goes away. Each pause makes one change, so one
// burst of typing is one step of undo and one row in Activity.
export const HELD_EDIT_PAUSE_MS = 1000;

export function holdsEdit(state: Pick<EditorState, "gesture">): boolean {
  return state.gesture?.label !== undefined;
}

// Saves the store's held edits after a pause, on pagehide, and when the document is hidden. Returns the stop function.
export function watchHeldEdits(store: EditorStore, target: { win: Window; doc: Document } = { win: window, doc: document }, pauseMs = HELD_EDIT_PAUSE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const save = () => {
    clear();
    store.getState().saveHeldEdit();
  };
  const unsubscribe = store.subscribe((state, before) => {
    // Only a new value restarts the wait: a teammate's change re-applies the same held edit, which is no typing.
    if (state.gesture?.ops === before.gesture?.ops) return;
    clear();
    if (!holdsEdit(state)) return;
    const ops = state.gesture?.ops;
    timer = setTimeout(() => {
      timer = null;
      if (store.getState().gesture?.ops === ops) store.getState().saveHeldEdit();
    }, pauseMs);
  });
  const onVisibility = () => {
    if (target.doc.visibilityState === "hidden") save();
  };
  target.win.addEventListener("pagehide", save);
  target.doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    clear();
    unsubscribe();
    target.win.removeEventListener("pagehide", save);
    target.doc.removeEventListener("visibilitychange", onVisibility);
  };
}
