"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { ApiFailure, ProjectApi } from "@/lib/editor/api";
import { createClipboard, type ClipboardStore } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore, type SettingsState, type SettingsStore } from "@/lib/editor/settings";
import type { EditorState, EditorStore } from "@/lib/editor/store";

type EditorContextValue = { store: EditorStore; api: ProjectApi; clipboard: ClipboardStore; settings: SettingsStore };

const EditorContext = createContext<EditorContextValue | null>(null);

const NETWORK: ApiFailure = { ok: false, kind: "network" };

// Used when no API is given, as in tests: every request fails as if the network were down.
const OFFLINE_API: ProjectApi = {
  postOps: async () => NETWORK,
  getVersion: async () => NETWORK,
  getOpsSince: async () => NETWORK,
  getProject: async () => NETWORK,
  rename: async () => NETWORK,
};

type EditorProviderProps = {
  store: EditorStore;
  api?: ProjectApi;
  clipboard?: ClipboardStore;
  settings?: SettingsStore;
  children: ReactNode;
};

// Without a clipboard, as in tests, copied clips are kept in memory. Without settings, the defaults are used and
// changes are kept in memory.
export function EditorProvider({ store, api, clipboard, settings, children }: EditorProviderProps) {
  const [memoryClipboard] = useState(createClipboard);
  const [memorySettings] = useState(() => createSettingsStore({ prefs: DEFAULT_PREFS }));
  const value = useMemo(
    () => ({ store, api: api ?? OFFLINE_API, clipboard: clipboard ?? memoryClipboard, settings: settings ?? memorySettings }),
    [store, api, clipboard, memoryClipboard, settings, memorySettings],
  );
  return <EditorContext value={value}>{children}</EditorContext>;
}

function useEditorContext(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("Editor components must be inside an EditorProvider.");
  return value;
}

// Reads from the editor store and re-renders when the selected value changes. The selector must
// return a primitive or an existing reference; wrap derived arrays and objects in useShallow.
export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorContext().store, selector);
}

export function useEditorStore(): EditorStore {
  return useEditorContext().store;
}

export function useEditorApi(): ProjectApi {
  return useEditorContext().api;
}

export function useClipboard(): ClipboardStore {
  return useEditorContext().clipboard;
}

// Reads this browser's preferences and re-renders when the selected value changes. A click, drop or key handler
// reads useSettingsStore().getState() at that moment instead.
export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(useEditorContext().settings, selector);
}

export function useSettingsStore(): SettingsStore {
  return useEditorContext().settings;
}
