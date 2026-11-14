"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type { PresenceState, PresenceStore } from "@/lib/editor/presence";

// Without a provider, as in tests that render parts of the editor, nobody else is here and nothing ever changes:
// receive and forget do nothing, and the store never notifies.
const EMPTY_STATE: PresenceState = Object.freeze({
  meColour: null,
  peers: Object.freeze([]) as unknown as PresenceState["peers"],
  heardAt: null,
  receive() {},
  forget() {},
});

const EMPTY_STORE: PresenceStore = Object.freeze({
  getState: () => EMPTY_STATE,
  getInitialState: () => EMPTY_STATE,
  setState: () => {},
  subscribe: () => () => {},
});

const PresenceContext = createContext<PresenceStore>(EMPTY_STORE);

export function PresenceProvider({ store, children }: { store: PresenceStore; children: ReactNode }) {
  return <PresenceContext value={store}>{children}</PresenceContext>;
}

// For handlers and effects that read the list at that moment or subscribe to it, like the board's overlay.
export function usePresenceStore(): PresenceStore {
  return useContext(PresenceContext);
}

// Reads teammates' selections and re-renders when the selected value changes. As with useEditor, the selector must
// return a primitive or an existing reference.
export function usePresence<T>(selector: (state: PresenceState) => T): T {
  return useStore(usePresenceStore(), selector);
}
