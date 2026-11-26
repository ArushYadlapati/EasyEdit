"use client";

import { Film } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useLibrary, useLocalFolder, useMedia, useMediaSpace } from "@/components/editor/media/media-context";
import { usePoster } from "@/components/editor/media/use-poster";
import { Button } from "@/components/ui/button";
import { DISABLED, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { formatLength } from "@/lib/media/messages";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { STYLE_WORDS } from "@/lib/style/messages";

const W = STYLE_WORDS.video;
const TEXT = "text-[13px] leading-5";
// The video files the Media tab takes.
const ACCEPT = ".mp4,.m4v,.mov,.webm";

function Tile({ asset, inStyle, disabled, onPick }: { asset: AssetView; inStyle: boolean; disabled: boolean; onPick(asset: AssetView): void }) {
  const poster = usePoster(asset, true);
  const uploading = asset.status !== "ready";
  const note = inStyle ? W.inStyle : uploading ? W.uploading : asset.durationMs !== null ? formatLength(asset.durationMs) : null;
  return (
    <li>
      <button
        type="button"
        disabled={disabled || inStyle || uploading}
        aria-label={inStyle ? `${asset.name}, ${W.inStyle}` : W.pick(asset.name)}
        className={cx("flex w-full min-w-0 flex-col gap-1 rounded-md border border-ed-line p-1 text-left enabled:hover:bg-ed-hover", FOCUS_RING, FADE, DISABLED)}
        onClick={() => onPick(asset)}
      >
        <span className="flex aspect-video items-center justify-center overflow-hidden rounded-sm bg-ed-bg text-ed-muted [&>svg]:size-5">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob address of the space's own video still
            <img src={poster} alt="" className="size-full object-cover" />
          ) : (
            <Film aria-hidden />
          )}
        </span>
        <span className={cx(TEXT, "truncate text-ed-text")}>{asset.name}</span>
        {note && <span className="text-xs text-ed-muted tabular-nums">{note}</span>}
      </button>
    </li>
  );
}

// The uploads started here that aren't in the list yet: on their way, or stopped, with why.
function Uploads({ items, shown }: { items: UploadItem[]; shown: ReadonlySet<string> }) {
  const waiting = items.filter((item) => item.stage !== "done" && !(item.assetId && shown.has(item.assetId)));
  if (waiting.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-col gap-1">
      {waiting.map((item) => (
        <li key={item.key} className={cx(TEXT, "flex min-w-0 flex-wrap gap-x-2")}>
          <span className="min-w-0 truncate text-ed-text">{item.fileName}</span>
          {item.stage === "failed" ? (
            item.message && <span className="min-w-0 text-ed-danger">{item.message}</span>
          ) : (
            <span className="shrink-0 text-ed-muted">{W.uploading}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export type AddVideoDialogProps = {
  open: boolean;
  onClose(): void;
  inStyle: ReadonlySet<string>; // ids of the videos the style already learns from
  adding: boolean; // a pick is on its way to the server
  problem: string | null; // why the last pick wasn't added
  onPick(asset: AssetView): void;
};

// Picks one of the space's videos for the style to learn from. A video is uploaded the way the Media tab uploads, and
// can be picked here once it is ready. Pictures and sounds aren't offered.
export function AddVideoDialog({ open, onClose, inStyle, adding, problem, onPick }: AddVideoDialogProps): ReactNode {
  const assets = useLibrary((s) => s.assets);
  const uploads = useLibrary((s) => s.uploads);
  const { queue } = useMedia();
  const setUp = useLibrary((s) => s.setUp);
  const { storageReady } = useMediaSpace();
  const { state: folderState } = useLocalFolder();
  // As in the Media tab: the space's storage takes uploads, or a media folder on this computer is open.
  const canUpload = (storageReady && setUp) || folderState === "ready";
  const input = useRef<HTMLInputElement>(null);
  const videos = Object.values(assets)
    .filter((asset) => asset.kind === "video" && !asset.removed)
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1));
  const shown = new Set(videos.filter((asset) => asset.status === "ready").map((asset) => asset.id));

  return (
    <Dialog
      title={W.title}
      open={open}
      onClose={onClose}
      footer={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
          <p className={cx(TEXT, "min-w-0 text-ed-muted")}>{canUpload ? W.uploadsShowHere : W.noStorage}</p>
          {canUpload && (
            <>
              <Button onClick={() => input.current?.click()}>{W.upload}</Button>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) queue.add(files);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      }
    >
      {problem && (
        <p role="alert" className={cx(TEXT, "mb-3 text-ed-danger")}>
          {problem}
        </p>
      )}
      <Uploads items={uploads} shown={shown} />
      {videos.length === 0 ? (
        <p className={cx(TEXT, "text-ed-muted")}>{W.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {videos.map((asset) => (
            <Tile key={asset.id} asset={asset} inStyle={inStyle.has(asset.id)} disabled={adding} onPick={onPick} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
