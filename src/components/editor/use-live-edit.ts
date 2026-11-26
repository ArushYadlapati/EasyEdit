"use client";

import { useCallback, useEffect, useRef } from "react";
import type { EditorStore } from "@/lib/editor/store";
import type { Op, OpInput } from "@/lib/timeline";

// A drag that shows each value as it goes and saves one change when let go. The store holds the drag's ops; this
// keeps the ones it started, so a drag someone else's change ended is never saved under this label. Leaving the
// screen mid-drag saves what was shown. It is a held edit (held-edit.ts): a pause, a hidden tab or the page going
// away saves it too, and the next move starts a new change from there.
export function useLiveEdit(store: EditorStore, label: string) {
  const own = useRef<Op[] | null>(null);
  const finish = useCallback(() => {
    const state = store.getState();
    if (own.current !== null && state.gesture?.ops === own.current) state.commitGesture(label);
    own.current = null;
  }, [store, label]);
  useEffect(() => finish, [finish]);
  return {
    preview(ops: OpInput[] | null) {
      const change = ops !== null && ops.length > 0 ? ops : null;
      store.getState().setGesture(change, label);
      own.current = change ? (store.getState().gesture?.ops ?? null) : null;
    },
    finish,
  };
}
