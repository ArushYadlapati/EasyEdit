import { makeFontResolver } from "@/lib/editor/fonts";
import { THUMBNAIL_SOURCE_MAX_SIDE, type ThumbnailDeps } from "@/lib/editor/thumbnail";
import { decodeImage, decodeVideoFrame } from "./media/frame-decode";
import type { MediaServices } from "./media/media-context";
import { cachedCssVar, loadFonts } from "./page-fonts";

// What drawing a thumbnail needs from this page: the editor's library and files, the browser's decoders and fonts, and
// a canvas that is never added to the page. A decode that throws answers null, so the still is drawn instead.
export function browserThumbnailDeps(media: MediaServices): ThumbnailDeps {
  return {
    library: () => media.library.getState(),
    readFile: async (fileId) => {
      const got = await media.files.get(fileId);
      return got.ok ? got.blob : null;
    },
    decodeVideo: (blob, seconds) => decodeVideoFrame(blob, seconds, THUMBNAIL_SOURCE_MAX_SIDE).catch(() => null),
    decodeImage: (blob) => decodeImage(blob, THUMBNAIL_SOURCE_MAX_SIDE).catch(() => null),
    loadFonts,
    resolveFont: makeFontResolver(cachedCssVar()),
    makeCanvas: (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
  };
}
