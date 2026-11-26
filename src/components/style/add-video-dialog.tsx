"use client";

import { Film } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useLibrary, useLocalFolder, useMedia, useMediaSpace } from "@/components/editor/media/media-context";
import { usePoster } from "@/components/editor/media/use-poster";
import { Button } from "@/components/ui/button";
import { DISABLED, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { MEDIA_MESSAGES, formatLength } from "@/lib/media/messages";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { STYLE_WORDS } from "@/lib/style/messages";

const W = STYLE_WORDS.video;
const TEXT = "text-[13px] leading-5";
// The video files the Media tab takes.
const ACCEPT = ".mp4,.m4v,.mov,.webm";

// One of the space's videos to pick. A video not uploaded yet can't be picked: it is on its way (sending: this page is
// sending it), or it is the person's own upload that stopped part way, which the same file picks up again.
function Tile({ asset, inStyle, sending, disabled, onPick }: { asset: AssetView; inStyle: boolean; sending: boolean; disabled: boolean; onPick(asset: AssetView): void }) {
  const poster = usePoster(asset, true);
  const uploading = asset.status !== "ready";
  const length = asset.durationMs !== null ? formatLength(asset.durationMs) : null;
  const note = inStyle ? W.inStyle : uploading ? (sending ? W.uploading : W.uploadStopped) : length;
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

// Picks one of the space's videos for the style to learn from. A video is uploaded the way the Media tab uploads, with
// Upload a video first in the footer and what happens next beside it: it can be picked here once it is ready. Pictures
// and sounds aren't offered. A media folder on this computer that the browser wants a click to open again is offered
// as the Media tab offers it, with Open folder.
export function AddVideoDialog({ open, onClose, inStyle, adding, problem, onPick }: AddVideoDialogProps): ReactNode {
  const assets = useLibrary((s) => s.assets);
  const uploads = useLibrary((s) => s.uploads);
  const { queue } = useMedia();
  const setUp = useLibrary((s) => s.setUp);
  const { storageReady } = useMediaSpace();
  const { folder, state: folderState, name: folderName } = useLocalFolder();
  // As in the Media tab: the space's storage takes uploads, or a media folder on this computer is open.
  const canUpload = (storageReady && setUp) || folderState === "ready";
  const input = useRef<HTMLInputElement>(null);
  const videos = Object.values(assets)
    .filter((asset) => asset.kind === "video" && !asset.removed)
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1));
  const shown = new Set(videos.filter((asset) => asset.status === "ready").map((asset) => asset.id));
  // The uploads this page is sending; any other unfinished one stopped when the page it was started on was left.
  const sending = new Set(uploads.flatMap((item) => (item.assetId && item.stage !== "done" && item.stage !== "failed" ? [item.assetId] : [])));

  return (
    <Dialog
      title={W.title}
      open={open}
      onClose={onClose}
      footer={
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
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
          {(canUpload || folderState !== "locked") && <p className={cx(TEXT, "min-w-0 text-ed-muted")}>{canUpload ? W.uploadsShowHere : W.noStorage}</p>}
          {folderState === "locked" && (
            <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <p className={cx(TEXT, "min-w-0 text-ed-muted")}>{MEDIA_MESSAGES.folderLocked(folderName ?? "your folder")}</p>
              <Button onClick={() => void folder.unlock()}>{STYLE_WORDS.learn.openFolder}</Button>
            </div>
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
            <Tile key={asset.id} asset={asset} inStyle={inStyle.has(asset.id)} sending={sending.has(asset.id)} disabled={adding} onPick={onPick} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
