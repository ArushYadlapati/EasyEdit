"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPresenceApi, createProjectApi } from "@/lib/editor/api";
import { createClipboard } from "@/lib/editor/clipboard";
import type { Layout } from "@/lib/editor/layout";
import { carriesFiles, createMediaDrop } from "@/lib/editor/media-drop";
import { createPresenceStore } from "@/lib/editor/presence";
import {
  DEFAULT_PREFS, PREFS_COOKIE, createSettingsStore, formatPrefs, parsePrefs, type Prefs, type SettingsSave,
} from "@/lib/editor/settings";
import { createEditorStore } from "@/lib/editor/store";
import { createSync } from "@/lib/editor/sync";
import { renderThumbnail } from "@/lib/editor/thumbnail";
import { startThumbnailTrigger } from "@/lib/editor/thumbnail-trigger";
import type { EditorInit } from "@/lib/editor/types";
import { createReviewApi } from "@/lib/review/client";
import { editorPath } from "@/lib/spaces/paths";
import { docAssetIds } from "@/lib/media/library-store";
import { readCookie, readKeymap, writeKeymap, writePrefsCookie } from "./browser-prefs";
import { EditorProvider, useEditor, useEditorStore } from "./context";
import { watchDrags } from "./drag-watch";
import type { GuideLink } from "@/lib/editor/menus";
import { EditorScreen } from "./editor-screen";
import type { SpaceKind } from "@/lib/spaces/types";
import type { StorageBlock } from "@/lib/storage/messages";
import { BrandProvider } from "./brand/brand-context";
import { CaptionsProvider } from "./captions/captions-context";
import { MediaProvider, createMediaServices, gateStorage, useLibrary, type StorageProblem } from "./media/media-context";
import { PresenceProvider } from "./presence-context";
import { ReviewProvider } from "./review/review-context";
import { browserThumbnailDeps } from "./thumbnail-deps";

const ACTIVITY_THROTTLE_MS = 1000;
const LIBRARY_TIMER_MS = 30_000; // the library store decides whether a tick fetches anything

// The browser's local storage, looked up on each use: the shell also renders on the server, and
// reaching localStorage can throw where storage is blocked. The clipboard copes with a throw.
const localStore = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

// A refresh or an ensure that fails has nothing to tell the shell: the library store keeps its own problem.
const quietly = (work: Promise<unknown>) => void work.catch(() => {});

// The space a project is in, as the editor page hands it over.
// kind, isAdmin, storageBlock: for the Media tab's setup card (see StorageSetup); left out, it offers no setup.
export type EditorSpace = {
  id: string;
  slug: string;
  storageReady: boolean;
  storageProblem?: StorageProblem;
  kind?: SpaceKind;
  isAdmin?: boolean;
  storageBlock?: StorageBlock;
  ownsConnection?: boolean; // whether the person connected the space's Google account (only they can reconnect it)
  ownerEmail?: string | null; // who did
  stock?: boolean; // whether this server has a stock library
};

// Owns the store, the API client, the sync, the media services, the project's dashboard picture and this browser's
// preferences for one open project, and ties them to the page: tab visibility, focus, coming back online, the user's
// clicks and keys, and leaving with unsent changes or running uploads. The panel sizes and the preferences come from the
// browser's cookies, which the page read; the keymap is read from local storage once the editor is on screen.
// space: the space the project is in (and its address slug), whether it has storage for uploads, and if not, why
// (storageProblem: "none", no storage; "broken", its Google connection needs reconnecting; null when it is ready;
// left out, it follows storageReady as MediaProvider says).
// guide: the guide's lessons, when the server has it, for the top bar's Help menu and search.
export function EditorShell({ initial, space, layout, prefs = DEFAULT_PREFS, guide }: { initial: EditorInit; space: EditorSpace; layout?: Layout; prefs?: Prefs; guide?: readonly GuideLink[] }) {
  const [{ store, api, sync, clipboard, media, drop, settings, savePrefs, presenceStore, review }] = useState(() => {
    const store = createEditorStore(initial, {
      view: { snapping: prefs.snapping, showSafeZones: prefs.safeZones, showGuides: prefs.guides, showAudioMeter: prefs.meter, audioMeterWidth: prefs.meterWidth },
    });
    const api = createProjectApi(initial.projectId);
    const presenceStore = createPresenceStore(initial.me.id);
    const presence = { api: createPresenceApi(initial.projectId), store: presenceStore };
    // With the space, a check that finds the project moved to another one stops this tab (see createSync).
    const sync = createSync({ store, api, isVisible: () => document.visibilityState === "visible", presence, spaceId: space.id });
    // Snapping, the safe area, guide and audio meter switches and the meter's width live in the editor store; the
    // cookie holds them with the rest.
    const savePrefs: SettingsSave["prefs"] = (chosen) => {
      const { snapping, showSafeZones, showGuides, showAudioMeter, audioMeterWidth } = store.getState();
      writePrefsCookie(
        formatPrefs({ ...chosen, snapping, safeZones: showSafeZones, guides: showGuides, meter: showAudioMeter, meterWidth: audioMeterWidth }),
      );
    };
    const settings = createSettingsStore({ prefs }, { prefs: savePrefs, keymap: (k) => writeKeymap(localStore, k) });
    const media = gateStorage(createMediaServices(space.id), space.storageReady);
    const drop = createMediaDrop({ store, library: media.library, queue: media.queue });
    const review = createReviewApi(initial.projectId);
    return { store, api, sync, clipboard: createClipboard(localStore), media, drop, settings, savePrefs, presenceStore, review };
  });

  useEffect(() => {
    // The Back button can bring back an older page, painted with preferences older than the cookie: the cookie's
    // are the ones last chosen, so they are taken, before the store is watched, so taking them saves nothing.
    const kept = readCookie(PREFS_COOKIE);
    if (kept !== null) {
      const { units, boardZoom, stillSeconds, textSeconds, snapping, safeZones, guides, meter, meterWidth } = parsePrefs(kept);
      const now = settings.getState();
      if (now.units !== units || now.boardZoom !== boardZoom || now.stillSeconds !== stillSeconds || now.textSeconds !== textSeconds) {
        settings.setState({ units, boardZoom, stillSeconds, textSeconds });
      }
      const view = store.getState();
      const differs =
        view.snapping !== snapping ||
        view.showSafeZones !== safeZones ||
        view.showGuides !== guides ||
        view.showAudioMeter !== meter ||
        view.audioMeterWidth !== meterWidth;
      if (differs) store.setState({ snapping, showSafeZones: safeZones, showGuides: guides, showAudioMeter: meter, audioMeterWidth: meterWidth });
    }
    // Read after mount, so the server's render and the first client render agree; loading it twice changes nothing.
    settings.getState().loadKeymap(readKeymap(localStore));
    // Every toggle of snapping, the safe area, the guides or the audio meter, from any control, is kept, and so is the
    // meter's width once a drag of its edge ends.
    return store.subscribe((state, before) => {
      const same =
        state.snapping === before.snapping &&
        state.showSafeZones === before.showSafeZones &&
        state.showGuides === before.showGuides &&
        state.showAudioMeter === before.showAudioMeter &&
        state.audioMeterWidth === before.audioMeterWidth;
      if (same) return;
      const { units, boardZoom, stillSeconds, textSeconds } = settings.getState();
      savePrefs({ units, boardZoom, stillSeconds, textSeconds });
    });
  }, [store, settings, savePrefs]);

  // The dashboard's picture of the project, drawn a few seconds after each save, and on open when the stored one is
  // missing or older. Declared before the page wiring, so on leaving it stops before the media services close.
  useEffect(() => {
    const deps = browserThumbnailDeps(media);
    return startThumbnailTrigger({
      store,
      storedVersion: initial.thumbnailVersion ?? null,
      capture: (doc, isCurrent) => renderThumbnail(doc, deps, isCurrent),
      upload: (version, jpeg) => api.putThumbnail(version, jpeg),
      onLibraryChange: (listener) => media.library.subscribe(() => listener()),
    });
  }, [store, api, media, initial.thumbnailVersion]);

  useEffect(() => {
    const { library, queue } = media;
    let lastActivity = 0;
    const onVisibilityChange = () => sync.visibilityChanged();
    // Teammates stop seeing this tab at once. Unlike unload, pagehide still lets the page be kept for Back, and a page
    // brought back from there checks at once.
    const onPageHide = () => sync.leave();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync.visibilityChanged();
    };
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
    // Closing the page now would lose edits not yet sent, stop uploads part way, stop the export that is running, or
    // drop a finished export not yet downloaded.
    const unsaved = () =>
      store.getState().queue.length > 0 || queue.active() > 0 || store.getState().exporting || store.getState().exportHeld;
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
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
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
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
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

  const projectHref = useCallback((projectId: string) => editorPath(space.slug, projectId), [space.slug]);

  return (
    <EditorProvider store={store} api={api} clipboard={clipboard} settings={settings}>
      <MediaProvider
        services={media}
        spaceId={space.id}
        storageReady={space.storageReady}
        storageProblem={space.storageProblem}
        stock={space.stock === true}
        storageSetup={
          space.kind
            ? {
                kind: space.kind,
                slug: space.slug,
                isAdmin: space.isAdmin === true,
                block: space.storageBlock ?? null,
                ownsConnection: space.ownsConnection === true,
                ownerEmail: space.ownerEmail ?? null,
              }
            : null
        }
        drop={drop}
      >
        <EditorBrand spaceId={space.id}>
          <CaptionsProvider>
            <PresenceProvider store={presenceStore}>
              <ReviewProvider api={review} projectHref={projectHref}>
                <EditorScreen spaceSlug={space.slug} spaceId={space.id} initialLayout={layout} guide={guide} />
              </ReviewProvider>
            </PresenceProvider>
          </CaptionsProvider>
        </EditorBrand>
      </MediaProvider>
    </EditorProvider>
  );
}

// The space's brand kit for the editor: editors change it as they can change the project, a refused change is told as
// the editor tells any other, and images in the media library show as logos the moment they are added.
function EditorBrand({ spaceId, children }: { spaceId: string; children: ReactNode }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const assets = useLibrary((s) => s.assets);
  const knownLogos = useMemo(() => Object.values(assets).filter((a) => a.kind === "image"), [assets]);
  return (
    <BrandProvider spaceId={spaceId} canEdit={canEdit} knownLogos={knownLogos} onError={(message) => store.getState().notify("error", message)}>
      {children}
    </BrandProvider>
  );
}
