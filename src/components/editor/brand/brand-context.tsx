"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchBrandKit, saveBrandKit } from "@/lib/brand/client";
import { DEFAULT_BRAND_KIT, type BrandKit, type BrandKitPatch } from "@/lib/brand/types";

export type BrandApi = { fetch: typeof fetchBrandKit; save: typeof saveBrandKit };

export type BrandState = {
  kit: BrandKit; // as the server last answered it, with the changes still on their way shown on top
  loaded: boolean; // the space's own kit has arrived (or was given)
  canEdit: boolean; // the person may change it, and it has loaded: a change made over the default kit would wipe the real one
  error: string | null; // the kit could not be loaded
  retry(): void;
  save(patch: BrandKitPatch): Promise<void>;
};

const DEFAULT_STATE: BrandState = { kit: DEFAULT_BRAND_KIT, loaded: false, canEdit: false, error: null, retry: () => {}, save: async () => {} };
export const LOAD_FAILED = "The brand kit couldn't be loaded.";
const BrandContext = createContext<BrandState>(DEFAULT_STATE);
const REAL_API: BrandApi = { fetch: fetchBrandKit, save: saveBrandKit };

// Changes the kit as if it were saved, then keeps what the server answers. The fields the patch names as the kit
// shows them; logos become the images already known, so the kit doesn't wait for the server to show the new order.
function applied(kit: BrandKit, patch: BrandKitPatch, knownLogos: BrandKit["logos"]): BrandKit {
  const byId = new Map(knownLogos.map((l) => [l.id, l]));
  return {
    ...kit,
    fonts: {
      title: patch.titleFont ?? kit.fonts.title,
      subtitle: patch.subtitleFont ?? kit.fonts.subtitle,
      body: patch.bodyFont ?? kit.fonts.body,
    },
    colors: patch.colors ? [...new Set(patch.colors.map((c) => c.toLowerCase()))] : kit.colors,
    logos: patch.logoAssetIds ? patch.logoAssetIds.flatMap((id) => byId.get(id) ?? []) : kit.logos,
  };
}

// The brand kit of one space, for whatever is inside: the editor (spaceId of the open project) or the dashboard's
// Brand kit page (with the kit it was rendered with as initial). Without a space it is the default kit, never fetched.
// Nothing can be changed until the space's kit has arrived; a failed load says so and can be retried.
// A change shows at once and is sent after the ones before it, one at a time, so the server takes them in the order
// they were made. What shows is the server's last answer with the changes still on their way on top: a refused change
// drops out (onError gets the server's words) and the later ones stay.
// knownLogos: images the caller knows (the editor's media library), so a newly added logo shows before the answer.
export function BrandProvider({
  spaceId,
  canEdit,
  initial,
  onError,
  knownLogos,
  api = REAL_API,
  children,
}: {
  spaceId: string | null;
  canEdit: boolean;
  initial?: BrandKit;
  onError?(message: string): void;
  knownLogos?: BrandKit["logos"];
  api?: BrandApi;
  children: ReactNode;
}): ReactNode {
  const confirmed = useRef<BrandKit>(initial ?? DEFAULT_BRAND_KIT);
  const pending = useRef<{ patch: BrandKitPatch }[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [kit, setKit] = useState<BrandKit>(initial ?? DEFAULT_BRAND_KIT);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const deps = useRef({ api, onError, knownLogos });
  useEffect(() => {
    deps.current = { api, onError, knownLogos };
  });

  // The server's kit with each change still on its way applied, in order.
  const show = useCallback(() => {
    const known = [...confirmed.current.logos, ...(deps.current.knownLogos ?? [])];
    setKit(pending.current.reduce((k, { patch }) => applied(k, patch, [...k.logos, ...known]), confirmed.current));
  }, []);

  useEffect(() => {
    if (!spaceId || initial !== undefined) return;
    let gone = false;
    deps.current.api.fetch(spaceId).then(
      (answer) => {
        if (gone) return;
        confirmed.current = answer;
        setLoaded(true);
        setError(null);
        show();
      },
      () => {
        if (!gone) setError(LOAD_FAILED);
      },
    );
    return () => {
      gone = true;
    };
    // initial is only read on the first render, as useState does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, attempt, show]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const editable = canEdit && loaded;
  const save = useCallback(
    (patch: BrandKitPatch): Promise<void> => {
      if (!spaceId || !editable) return Promise.resolve();
      const entry = { patch };
      pending.current = [...pending.current, entry];
      show();
      const run = queue.current.then(async () => {
        try {
          confirmed.current = await deps.current.api.save(spaceId, patch);
        } catch (err) {
          deps.current.onError?.(err instanceof Error ? err.message : "The brand kit could not be saved.");
        } finally {
          pending.current = pending.current.filter((p) => p !== entry);
          show();
        }
      });
      queue.current = run;
      return run;
    },
    [spaceId, editable, show],
  );

  const value = useMemo(() => ({ kit, loaded, canEdit: editable, error, retry, save }), [kit, loaded, editable, error, retry, save]);
  return <BrandContext value={value}>{children}</BrandContext>;
}

// The kit as the media library sees it now: each logo as the library last heard of it, leaving out any removed since
// the kit was loaded, so a stale logo is neither shown, added to a project, nor sent back in the next save.
export function withLibrary(kit: BrandKit, assets: Record<string, BrandKit["logos"][number]>): BrandKit {
  const logos = kit.logos.map((l) => assets[l.id] ?? l).filter((l) => !l.removed && l.status === "ready");
  return logos.length === kit.logos.length && logos.every((l, i) => l === kit.logos[i]) ? kit : { ...kit, logos };
}

export function useBrand(): BrandState {
  return useContext(BrandContext);
}
