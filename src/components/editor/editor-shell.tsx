"use client";

import { useEffect, useState } from "react";
import { createProjectApi } from "@/lib/editor/api";
import { createClipboard } from "@/lib/editor/clipboard";
import type { Layout } from "@/lib/editor/layout";
import { carriesFiles, createMediaDrop } from "@/lib/editor/media-drop";
import {
  DEFAULT_PREFS, PREFS_COOKIE, createSettingsStore, formatPrefs, parsePrefs, type Prefs, type SettingsSave,
} from "@/lib/editor/settings";
import { createEditorStore } from "@/lib/editor/store";
import { createSync } from "@/lib/editor/sync";
import type { EditorInit } from "@/lib/editor/types";
import { docAssetIds } from "@/lib/media/library-store";
import { readCookie, readKeymap, writeKeymap, writePrefsCookie } from "./browser-prefs";
import { EditorProvider } from "./context";
import { watchDrags } from "./drag-watch";
import { EditorScreen } from "./editor-screen";
import { MediaProvider, createMediaServices } from "./media/media-context";

const ACTIVITY_THROTTLE_MS = 1000;
const LIBRARY_TIMER_MS = 30_000; // the library store decides whether a tick fetches anything

// The browser's local storage, looked up on each use: the shell also renders on the server, and
// reaching localStorage can throw where storage is blocked. The clipboard copes with a throw.
const localStore = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

// A refresh or an ensure that fails has nothing to tell the shell: the library store keeps its own problem.
const quietly = (work: Promise<void>) => void work.catch(() => {});

// Owns the store, the API client, the sync, the media services and this browser's preferences for one open project,
// and ties them to the page: tab visibility, focus, coming back online, the user's clicks and keys, and leaving with
// unsent changes or running uploads. The panel sizes and the preferences come from the browser's cookies, which the
// page read; the keymap is read from local storage once the editor is on screen.
export function EditorShell({ initial, layout, prefs = DEFAULT_PREFS }: { initial: EditorInit; layout?: Layout; prefs?: Prefs }) {
  const [{ store, api, sync, clipboard, media, drop, settings, savePrefs }] = useState(() => {
    const store = createEditorStore(initial, { view: { snapping: prefs.snapping, showSafeZones: prefs.safeZones } });
    const api = createProjectApi(initial.projectId);
    const sync = createSync({ store, api, isVisible: () => document.visibilityState === "visible" });
    // Snapping and the safe area switch live in the editor store; the cookie holds them with the rest.
    const savePrefs: SettingsSave["prefs"] = (chosen) => {
      const { snapping, showSafeZones } = store.getState();
      writePrefsCookie(formatPrefs({ ...chosen, snapping, safeZones: showSafeZones }));
    };
    const settings = createSettingsStore({ prefs }, { prefs: savePrefs, keymap: (k) => writeKeymap(localStore, k) });
    const media = createMediaServices();
    const drop = createMediaDrop({ store, library: media.library, queue: media.queue });
    return { store, api, sync, clipboard: createClipboard(localStore), media, drop, settings, savePrefs };
  });

  useEffect(() => {
    // The Back button can bring back an older page, painted with preferences older than the cookie: the cookie's
    // are the ones last chosen, so they are taken, before the store is watched, so taking them saves nothing.
    const kept = readCookie(PREFS_COOKIE);
    if (kept !== null) {
      const { units, boardZoom, stillSeconds, textSeconds, snapping, safeZones } = parsePrefs(kept);
      const now = settings.getState();
      if (now.units !== units || now.boardZoom !== boardZoom || now.stillSeconds !== stillSeconds || now.textSeconds !== textSeconds) {
        settings.setState({ units, boardZoom, stillSeconds, textSeconds });
      }
      const view = store.getState();
      if (view.snapping !== snapping || view.showSafeZones !== safeZones) store.setState({ snapping, showSafeZones: safeZones });
    }
    // Read after mount, so the server's render and the first client render agree; loading it twice changes nothing.
    settings.getState().loadKeymap(readKeymap(localStore));
    // Every toggle of snapping or the safe area, from any control, is kept.
    return store.subscribe((state, before) => {
      if (state.snapping === before.snapping && state.showSafeZones === before.showSafeZones) return;
      const { units, boardZoom, stillSeconds, textSeconds } = settings.getState();
      savePrefs({ units, boardZoom, stillSeconds, textSeconds });
    });
  }, [store, settings, savePrefs]);

  useEffect(() => {
    const { library, queue } = media;
    let lastActivity = 0;
    const onVisibilityChange = () => sync.visibilityChanged();
    const onOnline = () => {
      sync.retryNow();
      queue.resume();
    };
    const onFocus = () => {
      quietly(library.getState().refresh("focus"));
      queue.resume();
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
      lastActivity = now;
      sync.noteActivity();
    };
    // Closing the page now would lose edits not yet sent, or stop uploads part way.
    const unsaved = () => store.getState().queue.length > 0 || queue.active() > 0;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsaved()) event.preventDefault();
    };
    // Listened for only while something would be lost: a beforeunload listener keeps the browser from
    // caching the page for back and forward, which an idle editor should not cost.
    let guarding = false;
    const guardUnload = (unsent: boolean) => {
      if (unsent === guarding) return;
      guarding = unsent;
      if (unsent) window.addEventListener("beforeunload", onBeforeUnload);
      else window.removeEventListener("beforeunload", onBeforeUnload);
    };
    const capture = { capture: true, passive: true };
    // Whether this person may drop anything now: an editor of a project that is still there.
    const allowed = () => {
      const { canEdit, status } = store.getState();
      return canEdit && status !== "deleted";
    };
    // A file drag that nothing in the editor took: the places that take files (the Media tab, and in time the
    // timeline and the preview) handle their own first and prevent the default. Anywhere else, such as the inspector,
    // the top row or the transport, a dropped file goes to the library only, for an editor with uploads set up while
    // no dialog is open; otherwise it is refused. Either way the browser never opens it in place of the editor. A drag
    // of text or of something on the page is left alone.
    const takesFiles = () => allowed() && library.getState().setUp && document.querySelector("dialog[open]") === null;
    const unhandledFiles = (event: DragEvent) => !event.defaultPrevented && carriesFiles([...(event.dataTransfer?.types ?? [])]);
    const onFileDragOver = (event: DragEvent) => {
      if (!unhandledFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = takesFiles() ? "copy" : "none";
    };
    const onFileDrop = (event: DragEvent) => {
      if (!unhandledFiles(event)) return;
      event.preventDefault();
      const files = [...(event.dataTransfer?.files ?? [])];
      if (takesFiles() && files.length > 0) queue.add(files);
    };

    // The browser's own menu is kept for text fields and links; elsewhere a right-click opens the editor's menu or
    // nothing. A control that opens its own menu has already prevented it.
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (event.defaultPrevented || !(target instanceof Element)) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if ((target instanceof HTMLElement && target.isContentEditable) || target.closest("a[href]")) return;
      event.preventDefault();
    };

    const stopDrop = drop.start();
    const stopWatching = watchDrags(window, drop, allowed);
    sync.start();
    quietly(library.getState().refresh("open"));
    quietly(library.getState().ensure(docAssetIds(store.getState().doc)));
    // The library is fetched again while the tab is visible; it fetches only while a visible preview is being made.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") quietly(library.getState().refresh("timer"));
    }, LIBRARY_TIMER_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pointerdown", onActivity, capture);
    window.addEventListener("keydown", onActivity, capture);
    window.addEventListener("dragover", onFileDragOver);
    window.addEventListener("drop", onFileDrop);
    window.addEventListener("contextmenu", onContextMenu);
    guardUnload(unsaved());
    const unsubscribe = store.subscribe((state, before) => {
      guardUnload(unsaved());
      // Each clip's asset is fetched once, so the timeline and the preview know it.
      if (state.doc !== before.doc) quietly(library.getState().ensure(docAssetIds(state.doc)));
    });
    const unsubscribeLibrary = library.subscribe((state, before) => {
      if (state.uploads !== before.uploads) guardUnload(unsaved());
    });
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerdown", onActivity, capture);
      window.removeEventListener("keydown", onActivity, capture);
      window.removeEventListener("dragover", onFileDragOver);
      window.removeEventListener("drop", onFileDrop);
      window.removeEventListener("contextmenu", onContextMenu);
      unsubscribe();
      unsubscribeLibrary();
      guardUnload(false);
      // Leaving inside the app (a link, the Back button) unmounts the editor without unloading
      // the page, so the edits still queued are sent first. Uploads stop where they are: an unfinished
      // one stays on the server, and is taken up when the same file is chosen again.
      sync.stopWhenSent();
      stopWatching();
      stopDrop();
      media.dispose();
    };
  }, [store, sync, media, drop]);

  return (
    <EditorProvider store={store} api={api} clipboard={clipboard} settings={settings}>
      <MediaProvider services={media} drop={drop}>
        <EditorScreen initialLayout={layout} />
      </MediaProvider>
    </EditorProvider>
  );
}
