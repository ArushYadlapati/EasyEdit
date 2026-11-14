import type { TimelineDoc } from "@/lib/timeline";
import type { EditorStore } from "./store";
import type { ThumbnailResult } from "./thumbnail";

export const THUMBNAIL_DELAY_MS = 4_000;

export type ThumbnailTriggerDeps = {
  store: EditorStore;
  storedVersion: number | null; // the stored picture's version when the page loaded; null: none
  // isCurrent turns false once the capture is stale (a newer save, leaving, edit access lost, the project deleted,
  // the editor playing, dragging or typing in place, or an export starting); renderThumbnail then stops at its next step.
  capture(doc: TimelineDoc, isCurrent: () => boolean): Promise<ThumbnailResult>;
  upload(version: number, jpeg: Blob): Promise<unknown>;
  onLibraryChange(listener: () => void): () => void;
  delayMs?: number; // THUMBNAIL_DELAY_MS
};

// Draws the project's dashboard picture of each saved version once things settle: delayMs after the last change to the
// saved version or the queue, while this person may edit, everything is saved and the editor is quiet. One restartable
// timer makes a burst of saves (and zustand's nested updates, seen twice) one picture. A version is drawn, skipped or
// failed once; the next save, or the next open, draws again. Nothing here touches the sync, the status or notices.
export function startThumbnailTrigger(deps: ThumbnailTriggerDeps): () => void {
  const { store } = deps;
  const delayMs = deps.delayMs ?? THUMBNAIL_DELAY_MS;
  let last = deps.storedVersion ?? -1; // the newest version drawn, skipped or stored
  let generation = 0; // moves on each new saved version and on stop, so a capture under way knows it is stale
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let waiting: (() => void) | null = null; // stops listening to the library while media is not ready
  let stopped = false;

  const wanted = () => {
    const { canEdit, status, queue, server } = store.getState();
    return canEdit && status === "saved" && queue.length === 0 && server.version > last;
  };
  // An export running in this tab counts as busy too, so no picture competes with it for decoders.
  const quiet = () => {
    const { playing, gesture, textEditId, exporting } = store.getState();
    return !playing && gesture === null && textEditId === null && !exporting;
  };

  const endWait = () => {
    const stopListening = waiting;
    waiting = null;
    stopListening?.();
  };

  const arm = (delay: number) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (stopped || running || waiting !== null || !wanted()) return;
    timer = setTimeout(fire, delay);
  };

  // Not quiet: the change that ends the playing, the drag, the typing or the export arms the timer again.
  function fire() {
    timer = null;
    if (!wanted() || !quiet()) return;
    const { doc, version } = store.getState().server;
    capture(doc, version);
  }

  function capture(doc: TimelineDoc, version: number) {
    running = true;
    const started = generation;
    const isCurrent = () => {
      const { canEdit, status } = store.getState();
      return !stopped && generation === started && canEdit && status !== "deleted" && quiet();
    };
    void Promise.resolve()
      .then(() => deps.capture(doc, isCurrent))
      .catch((): ThumbnailResult => ({ kind: "skip" }))
      .then((result) => {
        running = false;
        if (stopped) return;
        // A stale capture is dropped and last stays, so the same version is drawn again once things are quiet.
        if (isCurrent() && result.kind !== "stopped") {
          if (result.kind === "wait") {
            // Only re-armed, never captured from here: wanted and quiet are checked again first.
            waiting = deps.onLibraryChange(() => {
              endWait();
              arm(0);
            });
          } else {
            last = version;
            if (result.kind === "picture") {
              const { jpeg } = result;
              void Promise.resolve()
                .then(() => deps.upload(version, jpeg))
                .catch(() => {});
            }
          }
        }
        arm(delayMs);
      });
  }

  // Only compares fields and sets timers, so nothing here can throw into the store's other listeners.
  const unsubscribe = store.subscribe((state, before) => {
    const newVersion = state.server.version !== before.server.version;
    if (newVersion) {
      generation += 1;
      endWait();
    }
    if (
      newVersion ||
      state.queue !== before.queue ||
      state.status !== before.status ||
      state.canEdit !== before.canEdit ||
      state.playing !== before.playing ||
      state.gesture !== before.gesture ||
      state.textEditId !== before.textEditId ||
      state.exporting !== before.exporting
    ) {
      arm(delayMs);
    }
  });
  arm(delayMs);

  return () => {
    stopped = true;
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    endWait();
    unsubscribe();
  };
}
