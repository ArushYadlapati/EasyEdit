"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrandKitEditor } from "@/components/brand/brand-kit-editor";
import { BrandProvider, useBrand, type BrandApi } from "@/components/editor/brand/brand-context";
import { LogoPicker } from "@/components/editor/brand/logo-picker";
import { MediaProvider, createMediaServices, gateStorage, type MediaServices } from "@/components/editor/media/media-context";
import { cx } from "@/components/ui/cx";
import type { BrandKit } from "@/lib/brand/types";

const TEXT = "text-[13px] leading-5";

function Kit({ problem }: { problem: string | null }) {
  const { kit, canEdit, save } = useBrand();
  const [picking, setPicking] = useState(false);
  return (
    <>
      <p className={cx(TEXT, "text-ed-muted")}>
        {canEdit
          ? "New titles, subtitles and body text start in these fonts. Use the colors and logos from the Brand kit tab in the editor."
          : "New titles, subtitles and body text start in these fonts. Only editors can change the brand kit."}
      </p>
      {problem && (
        <p role="alert" className={cx(TEXT, "text-ed-danger")}>
          {problem}
        </p>
      )}
      <BrandKitEditor kit={kit} canEdit={canEdit} save={save} layout="page" onAddLogo={() => setPicking(true)} />
      <LogoPicker
        open={picking}
        onClose={() => setPicking(false)}
        inKit={new Set(kit.logos.map((l) => l.id))}
        onPick={(asset) => {
          setPicking(false);
          void save({ logoAssetIds: [...kit.logos.map((l) => l.id), asset.id] });
        }}
      />
    </>
  );
}

// The dashboard's Brand kit page: the same kit the editor's Brand kit tab shows, full width. The space's media library
// is loaded here too, for the logos' pictures and to pick or upload a new one. services and api: tests give their own.
export function BrandKitPage({
  spaceId,
  canEdit,
  initial,
  storageReady,
  services,
  api,
}: {
  spaceId: string;
  canEdit: boolean;
  initial: BrandKit;
  storageReady: boolean;
  services?: MediaServices;
  api?: BrandApi;
}): ReactNode {
  const media = useMemo(() => services ?? gateStorage(createMediaServices(spaceId), storageReady), [services, spaceId, storageReady]);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    media.library.getState().refresh("open").catch(() => {});
    return () => media.dispose();
  }, [media]);

  return (
    <MediaProvider services={media} spaceId={spaceId} storageReady={storageReady}>
      <BrandProvider spaceId={spaceId} canEdit={canEdit} initial={initial} api={api} onError={setProblem}>
        <Kit problem={problem} />
      </BrandProvider>
    </MediaProvider>
  );
}
