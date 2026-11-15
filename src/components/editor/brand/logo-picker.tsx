"use client";

import { useRef } from "react";
import { usePoster } from "@/components/editor/media/use-poster";
import { Button } from "@/components/ui/button";
import { DISABLED, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import type { AssetView } from "@/lib/media/types";
import { useLibrary, useMedia, useMediaSpace } from "../media/media-context";

const TEXT = "text-[13px] leading-5";

function Tile({ asset, inKit, onPick }: { asset: AssetView; inKit: boolean; onPick(asset: AssetView): void }) {
  const poster = usePoster(asset, true);
  return (
    <li>
      <button
        type="button"
        disabled={inKit}
        aria-label={inKit ? `${asset.name} is in the kit` : `Use ${asset.name}`}
        className={cx("flex w-full flex-col gap-1 rounded-md border border-ed-line p-1 text-left enabled:hover:bg-ed-hover", FOCUS_RING, FADE, DISABLED)}
        onClick={() => onPick(asset)}
      >
        <span className="flex aspect-square items-center justify-center overflow-hidden rounded-sm bg-ed-bg">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob address of the space's own image
            <img src={poster} alt="" className="size-full object-contain" />
          ) : null}
        </span>
        <span className={cx(TEXT, "truncate text-ed-text")}>{asset.name}</span>
        {inKit && <span className="text-xs text-ed-muted">In the kit</span>}
      </button>
    </li>
  );
}

// Picks a logo from the space's images. An image is uploaded the way the Media tab uploads, and shows here once it is
// ready, to be picked like any other. Videos and audio are not offered: a logo is a picture.
export function LogoPicker({ open, onClose, inKit, onPick }: { open: boolean; onClose(): void; inKit: ReadonlySet<string>; onPick(asset: AssetView): void }) {
  const assets = useLibrary((s) => s.assets);
  const { queue } = useMedia();
  const { storageReady } = useMediaSpace();
  const input = useRef<HTMLInputElement>(null);
  const images = Object.values(assets).filter((a) => a.kind === "image" && a.status === "ready" && !a.removed);

  return (
    <Dialog
      title="Add a logo"
      open={open}
      onClose={onClose}
      footer={
        storageReady ? (
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <p className={cx(TEXT, "text-ed-muted")}>Uploads show here once they are ready.</p>
            <Button onClick={() => input.current?.click()}>Upload image</Button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) queue.add(files);
                e.target.value = "";
              }}
            />
          </div>
        ) : null
      }
    >
      {images.length === 0 ? (
        <p className={cx(TEXT, "text-ed-muted")}>This space has no images yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((asset) => (
            <Tile key={asset.id} asset={asset} inKit={inKit.has(asset.id)} onPick={onPick} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
