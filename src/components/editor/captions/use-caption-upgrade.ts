"use client";

import { useEffect } from "react";
import { upgradeCaptionOps } from "@/lib/captions/actions";
import { editBlocked } from "@/lib/editor/menus";
import type { EditorStore } from "@/lib/editor/store";

// A project whose captions were switched on the old way (a flag on each clip) gets caption clips the first time someone
// who can edit has it open, so its captions are one block per clip that can be selected and split. Each set of flagged
// clips is tried once: a refusal (a teammate made the same edit first) puts the flags back, and is not tried again.
// A change made during a drag waits for the drag to end.
export function useCaptionUpgrade(store: EditorStore): void {
  useEffect(() => {
    const tried = new Set<string>();
    const check = () => {
      const state = store.getState();
      if (editBlocked(state)) return;
      const ops = upgradeCaptionOps(state.doc);
      if (ops.length === 0) return;
      const key = ops.map((op) => (op.op === "update_clip" ? op.clipId : "")).join(",");
      if (tried.has(key)) return;
      tried.add(key);
      state.edit(ops, "captions as clips");
    };
    check();
    return store.subscribe((now, before) => {
      if (now.doc !== before.doc || now.canEdit !== before.canEdit || now.gesture !== before.gesture || now.status !== before.status) check();
    });
  }, [store]);
}
