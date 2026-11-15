"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { ApiFailure, ProjectApi } from "@/lib/editor/api";
import { createClipboard, type ClipboardStore } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore, type SettingsState, type SettingsStore } from "@/lib/editor/settings";
import type { EditorState, EditorStore } from "@/lib/editor/store";
import { browserExportDeps } from "./export/browser-deps";
import type { ExportDeps } from "./export/deps";
import { useMedia } from "./media/media-context";

type EditorContextValue = {
  store: EditorStore;
  api: ProjectApi;
  clipboard: ClipboardStore;
  settings: SettingsStore;
  exportDeps: ExportDeps | null;
};

const EditorContext = createContext<EditorContextValue | null>(null);
// This browser's preferences, on their own so that Settings can open where no project is (the dashboard). The editor
// provides it too.
const SettingsContext = createContext<SettingsStore | null>(null);

export function SettingsProvider({ settings, children }: { settings: SettingsStore; children: ReactNode }) {
  return <SettingsContext value={settings}>{children}</SettingsContext>;
}

const NETWORK: ApiFailure = { ok: false, kind: "network" };

// Used when no API is given, as in tests: every request fails as if the network were down.
const OFFLINE_API: ProjectApi = {
  postOps: async () => NETWORK,
  getVersion: async () => NETWORK,
  getOpsSince: async () => NETWORK,
  getProject: async () => NETWORK,
  rename: async () => NETWORK,
  putThumbnail: async () => NETWORK,
};

type EditorProviderProps = {
  store: EditorStore;
  api?: ProjectApi;
  clipboard?: ClipboardStore;
  settings?: SettingsStore;
  exportDeps?: ExportDeps;
  children: ReactNode;
};

// Without a clipboard, as in tests, copied clips are kept in memory. Without settings, the defaults are used and
// changes are kept in memory. Without exportDeps, an export uses this browser's, over the editor's media services.
export function EditorProvider({ store, api, clipboard, settings, exportDeps, children }: EditorProviderProps) {
  const [memoryClipboard] = useState(createClipboard);
  const [memorySettings] = useState(() => createSettingsStore({ prefs: DEFAULT_PREFS }));
  const value = useMemo(
    () => ({
      store,
      api: api ?? OFFLINE_API,
      clipboard: clipboard ?? memoryClipboard,
      settings: settings ?? memorySettings,
      exportDeps: exportDeps ?? null,
    }),
    [store, api, clipboard, memoryClipboard, settings, memorySettings, exportDeps],
  );
  return (
    <EditorContext value={value}>
      <SettingsProvider settings={value.settings}>{children}</SettingsProvider>
    </EditorContext>
  );
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
  return useStore(useSettingsStore(), selector);
}

export function useSettingsStore(): SettingsStore {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("Settings components must be inside a SettingsProvider or an EditorProvider.");
  return settings;
}

// What an export needs from the browser: the provider's when given (tests pass fakes), else this browser's over the
// editor's media services, made once per media services.
export function useExportDeps(): ExportDeps {
  const given = useEditorContext().exportDeps;
  const media = useMedia();
  return useMemo(() => given ?? browserExportDeps(media), [given, media]);
}
