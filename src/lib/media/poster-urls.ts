import type { MediaFiles } from "./media-files";

// One blob address per still picture, shared by everything that shows it (the Media tab's tiles and the timeline's
// clips), so a still is read, addressed and decoded once however many clips show it.
export type PosterUrls = {
  url(fileId: string): string | null; // the still's address once it is read, while someone holds it
  hold(fileId: string): () => void; // reads it once and keeps its address while held; the last let-go revokes it
  subscribe(listener: () => void): () => void; // an address came or went
};

type Held = { holds: number; url: string | null; reading: boolean };

export function createPosterUrls(deps: { files: MediaFiles; objectUrl(blob: Blob): string; revokeUrl(url: string): void }): PosterUrls {
  const held = new Map<string, Held>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  // A read that ends after the last let-go, or that fails, leaves nothing: no address and no change, so a later hold reads again.
  function read(fileId: string, entry: Held) {
    entry.reading = true;
    const done = (blob: Blob | null) => {
      if (held.get(fileId) !== entry) return;
      entry.reading = false;
      if (blob === null) return;
      entry.url = deps.objectUrl(blob);
      changed();
    };
    deps.files.get(fileId).then(
      (got) => done(got.ok ? got.blob : null),
      () => done(null),
    );
  }

  return {
    url: (fileId) => held.get(fileId)?.url ?? null,
    hold(fileId) {
      let entry = held.get(fileId);
      if (!entry) {
        entry = { holds: 0, url: null, reading: false };
        held.set(fileId, entry);
      }
      entry.holds += 1;
      if (entry.url === null && !entry.reading) read(fileId, entry);
      const mine = entry;
      let released = false; // letting go twice counts once
      return () => {
        if (released) return;
        released = true;
        mine.holds -= 1;
        if (mine.holds > 0) return;
        held.delete(fileId);
        if (mine.url !== null) {
          deps.revokeUrl(mine.url);
          changed();
        }
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
