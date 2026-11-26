"use client";

import { Clapperboard, Film, Link2, X } from "lucide-react";
import type { ReactNode } from "react";
import { usePoster } from "@/components/editor/media/use-poster";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import type { AssetView } from "@/lib/media/types";
import { sheetUrl } from "@/lib/style/client";
import { progressWords, referenceFacts } from "@/lib/style/describe";
import { isThumbnailHost } from "@/lib/style/links";
import { STYLE_WORDS } from "@/lib/style/messages";
import type { StyleReference } from "@/lib/style/types";
import type { ReferenceProgress } from "./use-analyze-reference";

const W = STYLE_WORDS.learn;
const BOX = "flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ed-line bg-ed-bg text-ed-muted sm:w-24 [&>svg]:size-5";

function AssetPicture({ asset }: { asset: AssetView }) {
  const poster = usePoster(asset, true);
  return poster ? (
    // eslint-disable-next-line @next/next/no-img-element -- a blob address of the space's own video still
    <img src={poster} alt="" className="size-full object-cover" />
  ) : (
    <Film aria-hidden />
  );
}

// The picture at the start of a card: a measured video's strip of frames, else its still from the library; a link's
// picture from its site (sent no page address); a neutral mark for anything else.
function Picture({ reference, asset }: { reference: StyleReference; asset: AssetView | undefined }) {
  const facts = reference.analysis;
  let inside: ReactNode;
  if (reference.kind === "video" && reference.hasSheet && facts?.kind === "video") {
    // eslint-disable-next-line @next/next/no-img-element -- the reference's own strip of frames, served by EasyEdit
    inside = <img src={sheetUrl(reference.id, facts.analyzedAt)} alt="" className="size-full object-cover" />;
  } else if (reference.kind === "video") {
    inside = asset ? <AssetPicture asset={asset} /> : <Film aria-hidden />;
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
  busy: boolean; // a remove or a refresh is on its way
  onRemove(): void;
  onTryAgain(): void;
  onRefresh?(): void; // without it there is no Refresh
};

// One thing the style learns from, as a row: its picture, its title (a link's opens its video), one line of facts, and
// where it is: being looked at, not looked at yet, or why it couldn't be, with Try again. Editors can remove it.
export function ReferenceCard({ reference, asset, progress, error, canEdit, stale, busy, onRemove, onTryAgain, onRefresh }: ReferenceCardProps): ReactNode {
  const facts = referenceFacts(reference);
  const failure = error ?? (reference.status === "failed" ? (reference.failure ?? STYLE_WORDS.analysisFailed.unknown) : null);
  let status: ReactNode = null;
  if (progress) {
    status = <p className="text-xs leading-4 text-ed-text tabular-nums">{progressWords(progress)}</p>;
  } else if (reference.kind === "video" && failure) {
    status = (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p role={error ? "alert" : undefined} className="min-w-0 text-xs leading-4 text-ed-danger">
          {failure}
        </p>
        {canEdit && (
          <Button size="sm" onClick={onTryAgain}>
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
          <Button size="sm" disabled={busy} onClick={onRefresh}>
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
            {reference.title}
          </a>
        ) : (
          <p className="truncate text-[13px] leading-5 font-medium text-ed-text">{reference.title}</p>
        )}
        {facts && <p className="text-xs leading-4 break-words text-ed-muted">{facts}</p>}
        {status}
      </div>
      {canEdit && (
        <IconButton label={W.remove(reference.title)} disabled={busy} onClick={onRemove}>
          <X />
        </IconButton>
      )}
    </li>
  );
}
