"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { MediaFiles } from "@/lib/media/media-files";
import { createPosterUrls, type PosterUrls } from "@/lib/media/poster-urls";
import type { AssetView } from "@/lib/media/types";
import { useMedia } from "./media-context";

// One set of shared still addresses per set of media files. Keyed by the files, not by file id alone, so two editors
// (or two tests) that use the same ids never share an address.
const POSTER_URLS = new WeakMap<MediaFiles, PosterUrls>();

function posterUrlsFor(files: MediaFiles): PosterUrls {
  let urls = POSTER_URLS.get(files);
  if (!urls) {
    urls = createPosterUrls({ files, objectUrl: (blob) => URL.createObjectURL(blob), revokeUrl: (url) => URL.revokeObjectURL(url) });
    POSTER_URLS.set(files, urls);
  }
  return urls;
}

// A still picture as a blob address for an <img>, or null until it is read (and for null). While this is mounted with
// a file id, the still is held: it is read once however many places show it, and its address is released when the
// last of them goes. A still someone already holds shows at once.
export function usePosterUrl(fileId: string | null): string | null {
  const urls = posterUrlsFor(useMedia().files);
  const url = useSyncExternalStore(
    urls.subscribe,
    () => (fileId === null ? null : urls.url(fileId)),
    () => null,
  );
  useEffect(() => (fileId === null ? undefined : urls.hold(fileId)), [urls, fileId]);
  return url;
}

// The still picture of an asset, as a blob address for an <img>, or null until it is here (and for audio, or an
// asset without one). It is read through `files.get` only once `inView` has been true, so a row that never scrolls
// into view reads nothing. The address is released when the row goes away or names another picture.
export function usePoster(asset: AssetView, inView: boolean): string | null {
  const [seen, setSeen] = useState(inView);
  if (inView && !seen) setSeen(true); // once seen, the picture is kept while the row is there
  const fileId = asset.kind === "audio" ? null : asset.posterFileId;
  return usePosterUrl(seen ? fileId : null);
}
