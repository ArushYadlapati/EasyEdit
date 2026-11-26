"use client";

import { Clapperboard, Film, Link2, X } from "lucide-react";
import type { ReactNode } from "react";
import { usePoster } from "@/components/editor/media/use-poster";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import type { AssetView } from "@/lib/media/types";
import { sheetUrl } from "@/lib/style/client";
import { canTryAgain, progressWords, referenceFacts, referenceTitle } from "@/lib/style/describe";
import { isThumbnailHost } from "@/lib/style/links";
import { STYLE_WORDS } from "@/lib/style/messages";
import type { SheetPlan, StyleReference } from "@/lib/style/types";
import type { ReferenceProgress } from "./use-analyze-reference";

const W = STYLE_WORDS.learn;
const BOX =
  "relative flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ed-line bg-ed-bg text-ed-muted sm:w-24 [&>svg]:size-5";

// A video's still from the library, with what to show until it has loaded, or if it never does.
function AssetPicture({ asset, until }: { asset: AssetView; until: ReactNode }) {
  const poster = usePoster(asset, true);
  return poster ? (
    // eslint-disable-next-line @next/next/no-img-element -- a blob address of the space's own video still
    <img src={poster} alt="" className="size-full object-cover" />
  ) : (
    until
  );
}

// The first tile of a video's strip of frames, filling the card's 16:9 box the way a cover-fit picture would: the strip
// is drawn columns × rows times the tile's size, from the tile's top-left corner, inside a tile-shaped window that
// covers the box. A tile has the video's shape (sheetGrid in video-facts.ts), so a tall video's is cut to its middle.
function FirstTile({ src, sheet, width, height }: { src: string; sheet: SheetPlan; width: number; height: number }) {
  const wider = width * 9 >= height * 16; // at least as wide as the box, so the tile is as tall as the box
  return (
    <span
      className={cx("absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden", wider ? "h-full" : "w-full")}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own strip of frames, served by EasyEdit */}
      <img
        src={src}
        alt=""
        className="absolute top-0 left-0 max-w-none"
        style={{ width: `${sheet.columns * 100}%`, height: `${sheet.rows * 100}%` }}
      />
    </span>
  );
}

// The picture at the start of a card: a video's still from the library, as the Media tab shows it; until that has
// loaded, or when the video isn't in the library, the first frame of its strip once it has been measured (the whole
// strip is for agents: at this size it is a mosaic). A link's picture from its site (sent no page address); a neutral
// mark for anything else.
function Picture({ reference, asset }: { reference: StyleReference; asset: AssetView | undefined }) {
  const facts = reference.analysis;
  let inside: ReactNode;
  if (reference.kind === "video") {
    const tile =
      reference.hasSheet && facts?.kind === "video" && facts.sheet ? (
        <FirstTile src={sheetUrl(reference.id, facts.analyzedAt)} sheet={facts.sheet} width={facts.width} height={facts.height} />
      ) : null;
    const until = tile ?? <Film aria-hidden />;
    inside = asset ? <AssetPicture asset={asset} until={until} /> : until;
  } else if (reference.kind === "link" && reference.thumbnailUrl && isThumbnailHost(reference.thumbnailUrl)) {
    inside = (
      // eslint-disable-next-line @next/next/no-img-element -- a small picture on YouTube's, Vimeo's or TikTok's own servers; next/image would fetch it through ours.
      <img src={reference.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
    );
  } else {
    inside = reference.kind === "link" ? <Link2 aria-hidden /> : <Clapperboard aria-hidden />;
  }
  return <span className={BOX}>{inside}</span>;
}

export type ReferenceCardProps = {
  reference: StyleReference;
  asset: AssetView | undefined; // a video reference's video, from the library, once it is there
  progress: ReferenceProgress | undefined; // while this browser looks the video over
  error: string | null; // what this browser couldn't save just now, in the person's words
  canEdit: boolean;
  stale: boolean; // a channel video whose details were cut back, which Refresh reads again
  busy: boolean; // a remove, a refresh, a look-up for Try again or opening the media folder is on its way
  // The name of the media folder on this computer that a video's files are kept in, while the browser wants a click
  // to open it again; null otherwise, and always for a viewer.
  lockedFolder: string | null;
  onRemove(): void;
  onTryAgain(): void;
  onOpenFolder(): void;
  onRefresh?(): void; // without it there is no Refresh
};

// One thing the style learns from, as a row: its picture, its title (a link's opens its video), one line of facts, and
// where it is: being looked at, not looked at yet, or why it couldn't be, with Try again where trying again can help.
// A video waiting on a media folder this computer has to open again says so, with Open folder. Editors can remove
// it. A viewer is told that a video couldn't be looked at, but not the reason, which is for the editor whose browser
// tried.
export function ReferenceCard({
  reference,
  asset,
  progress,
  error,
  canEdit,
  stale,
  busy,
  lockedFolder,
  onRemove,
  onTryAgain,
  onOpenFolder,
  onRefresh,
}: ReferenceCardProps): ReactNode {
  const facts = referenceFacts(reference);
  const title = referenceTitle(reference);
  const failure = error ?? (reference.status === "failed" ? (reference.failure ?? STYLE_WORDS.analysisFailed.unknown) : null);
  let status: ReactNode = null;
  if (progress) {
    status = <p className="text-xs leading-4 text-ed-text tabular-nums">{progressWords(progress)}</p>;
  } else if (reference.kind === "video" && failure && !canEdit) {
    status = <p className="text-xs leading-4 text-ed-muted">{W.failedViewer}</p>;
  } else if (reference.kind === "video" && canEdit && lockedFolder !== null && (failure ? canTryAgain(failure, asset?.durationMs) : reference.status === "pending")) {
    // Its file can't be read until the folder is open, so that is the one thing to do; what failed before may not
    // fail again once it is. A failure that would only come back (too long) is shown as it is, with no way to retry.
    status = (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 text-xs leading-4 text-ed-muted">{W.folderLocked(lockedFolder)}</p>
        <Button disabled={busy} onClick={onOpenFolder}>
          {W.openFolder}
        </Button>
      </div>
    );
  } else if (reference.kind === "video" && failure) {
    status = (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p role={error ? "alert" : undefined} className="min-w-0 text-xs leading-4 text-ed-danger">
          {failure}
        </p>
        {canTryAgain(failure, asset?.durationMs) && (
          <Button disabled={busy} onClick={onTryAgain}>
            {W.tryAgain}
          </Button>
        )}
      </div>
    );
  } else if (reference.kind === "video" && reference.status === "pending" && canEdit && asset?.removed) {
    // Its video was taken out of the media before anyone looked at it, so it never will be.
    status = <p className="text-xs leading-4 text-ed-danger">{STYLE_WORDS.analysisFailed.missing}</p>;
  } else if (reference.kind === "video" && reference.status === "pending") {
    status = <p className="text-xs leading-4 text-ed-muted">{canEdit ? W.notLookedAt : W.notLookedAtViewer}</p>;
  } else if (stale) {
    // A refresh that didn't go through says why in place of the stale line, with Refresh still there.
    status = (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p role={error ? "alert" : undefined} className={cx("min-w-0 text-xs leading-4", error ? "text-ed-danger" : "text-ed-muted")}>
          {error ?? W.channelStale}
        </p>
        {canEdit && onRefresh && (
          <Button disabled={busy} onClick={onRefresh}>
            {W.refresh}
          </Button>
        )}
      </div>
    );
  } else if (error) {
    status = (
      <p role="alert" className="text-xs leading-4 text-ed-danger">
        {error}
      </p>
    );
  }

  return (
    <li className="flex min-w-0 items-start gap-3 px-3 py-2">
      <Picture reference={reference} asset={asset} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {reference.url ? (
          <a
            href={reference.url}
            target="_blank"
            rel="noreferrer"
            className={cx("max-w-full self-start truncate rounded-sm text-[13px] leading-5 font-medium text-ed-text underline-offset-2 hover:underline", FOCUS_RING, FADE)}
          >
            {title}
          </a>
        ) : (
          <p className="truncate text-[13px] leading-5 font-medium text-ed-text">{title}</p>
        )}
        {facts && <p className="text-xs leading-4 break-words text-ed-muted">{facts}</p>}
        {status}
      </div>
      {canEdit && (
        <IconButton label={W.remove(title)} disabled={busy} onClick={onRemove}>
          <X />
        </IconButton>
      )}
    </li>
  );
}
