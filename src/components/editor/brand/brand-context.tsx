"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchBrandKit, saveBrandKit } from "@/lib/brand/client";
import { DEFAULT_BRAND_KIT, type BrandKit, type BrandKitPatch } from "@/lib/brand/types";

export type BrandApi = { fetch: typeof fetchBrandKit; save: typeof saveBrandKit };

export type BrandState = {
  kit: BrandKit;
  loaded: boolean; // the space's own kit has arrived (or was given)
  canEdit: boolean;
  save(patch: BrandKitPatch): Promise<void>;
};

const DEFAULT_STATE: BrandState = { kit: DEFAULT_BRAND_KIT, loaded: false, canEdit: false, save: async () => {} };
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
// A save shows at once; when the server refuses it the kit goes back as it was and onError gets the server's words.
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
  const [kit, setKitState] = useState<BrandKit>(initial ?? DEFAULT_BRAND_KIT);
  const [loaded, setLoaded] = useState(initial !== undefined);
  // The kit as last set, for a save made before React has drawn the one before it.
  const latest = useRef(kit);
  const setKit = useCallback((next: BrandKit) => {
    latest.current = next;
    setKitState(next);
  }, []);
  const deps = useRef({ api, onError, knownLogos });
  useEffect(() => {
    deps.current = { api, onError, knownLogos };
  });

  useEffect(() => {
    if (!spaceId || initial !== undefined) return;
    let gone = false;
    deps.current.api.fetch(spaceId).then(
      (answer) => {
        if (gone) return;
        setKit(answer);
        setLoaded(true);
      },
      () => {
        // The default kit stays; the Text tab still works.
      },
    );
    return () => {
      gone = true;
    };
    // initial is only read on the first render, as useState does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, setKit]);

  const save = useCallback(
    async (patch: BrandKitPatch) => {
      if (!spaceId || !canEdit) return;
      const before = latest.current;
      const known = [...before.logos, ...(deps.current.knownLogos ?? [])];
      setKit(applied(before, patch, known));
      try {
        setKit(await deps.current.api.save(spaceId, patch));
      } catch (error) {
        setKit(before);
        deps.current.onError?.(error instanceof Error ? error.message : "The brand kit could not be saved.");
      }
    },
    [spaceId, canEdit, setKit],
  );

  const value = useMemo(() => ({ kit, loaded, canEdit, save }), [kit, loaded, canEdit, save]);
  return <BrandContext value={value}>{children}</BrandContext>;
}

export function useBrand(): BrandState {
  return useContext(BrandContext);
}
