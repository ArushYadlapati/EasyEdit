"use client";

import { Film } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { linkButtonClass } from "@/components/ui/button-class";
import { Dialog } from "@/components/ui/dialog";
import { cx } from "@/components/ui/cx";
import type { ChannelUpload } from "@/lib/social/youtube-api";
import { settingsTabPath } from "@/lib/spaces/settings-tabs";
import type { ChannelStatus } from "@/lib/style/channel";
import { lengthWords } from "@/lib/style/describe";
import { isThumbnailHost } from "@/lib/style/links";
import { STYLE_MESSAGES, STYLE_WORDS } from "@/lib/style/messages";
import { failureWords } from "./style-api";

const W = STYLE_WORDS.channel;
const TEXT = "text-[13px] leading-5";

type Loaded = { state: "loading" } | { state: "shown"; status: ChannelStatus } | { state: "failed"; message: string };

function Upload({ video, added, disabled, onAdd }: { video: ChannelUpload; added: boolean; disabled: boolean; onAdd(): void }) {
  const picture = video.thumbnailUrl && isThumbnailHost(video.thumbnailUrl) ? video.thumbnailUrl : null;
  return (
    <li className="flex min-w-0 items-center gap-3 px-3 py-2">
      <span className="flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ed-line bg-ed-bg text-ed-muted [&>svg]:size-5">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small picture on YouTube's own servers; next/image would fetch it through ours.
          <img src={picture} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <Film aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx(TEXT, "truncate text-ed-text")}>{video.title}</span>
        {video.seconds !== undefined && <span className="text-xs text-ed-muted tabular-nums">{lengthWords(video.seconds)}</span>}
      </span>
      {added ? (
        <span className="shrink-0 text-xs text-ed-muted">{W.added}</span>
      ) : (
        <Button size="sm" aria-label={W.addLabel(video.title)} disabled={disabled} onClick={onAdd}>
          {W.add}
        </Button>
      )}
    </li>
  );
}

export type ChannelDialogProps = {
  open: boolean;
  onClose(): void;
  spaceSlug: string;
  isAdmin: boolean; // only admins can connect a channel, in the Socials tab
  inStyle: ReadonlySet<string>; // the video addresses the style already learns from
  full: boolean; // the style has no room for another
  fetchChannel(): Promise<ChannelStatus>; // the same function from one render to the next, or it asks again
  add(video: ChannelUpload): Promise<string | null>; // why it wasn't added, or null when it was
};

// Lists the newest uploads of the space's connected YouTube channel, each with Add. With no channel to read, it says
// why, and how to connect one. It asks the channel once it opens; the page gives each opening a new key, so each time
// it asks afresh.
export function ChannelDialog({ open, onClose, spaceSlug, isAdmin, inStyle, full, fetchChannel, add }: ChannelDialogProps): ReactNode {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [adding, setAdding] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetchChannel().then(
      (status) => live && setLoaded({ state: "shown", status }),
      (error: unknown) => live && setLoaded({ state: "failed", message: failureWords(error) }),
    );
    return () => {
      live = false;
    };
  }, [open, fetchChannel]);

  async function addOne(video: ChannelUpload) {
    setAdding(video.id);
    setProblem(null);
    const stopped = await add(video);
    setAdding(null);
    setProblem(stopped);
  }

  let body: ReactNode;
  if (loaded.state === "loading") body = <p className={cx(TEXT, "text-ed-muted")}>{W.loading}</p>;
  else if (loaded.state === "failed")
    body = (
      <p role="alert" className={cx(TEXT, "text-ed-danger")}>
        {loaded.message}
      </p>
    );
  else if (!loaded.status.on) body = <p className={cx(TEXT, "text-ed-muted")}>{STYLE_MESSAGES.channelOff}</p>;
  else if (!loaded.status.connected) {
    const { message, broken } = loaded.status;
    body = (
      <div className="flex flex-col gap-3">
        <p role={broken ? "alert" : undefined} className={cx(TEXT, broken ? "text-ed-danger" : "text-ed-text")}>
          {message ?? W.notConnected}
        </p>
        {isAdmin ? (
          <Link href={settingsTabPath(spaceSlug, "socials")} className={linkButtonClass("default", "self-start")}>
            {W.connect}
          </Link>
        ) : (
          <p className={cx(TEXT, "text-ed-muted")}>{W.askAdmin}</p>
        )}
      </div>
    );
  } else {
    const { channelTitle, videos } = loaded.status;
    body = (
      <div className="flex flex-col gap-3">
        <p className={cx(TEXT, "text-ed-text")}>{W.newest(channelTitle)}</p>
        {problem && (
          <p role="alert" className={cx(TEXT, "text-ed-danger")}>
            {problem}
          </p>
        )}
        {full && <p className={cx(TEXT, "text-ed-muted")}>{STYLE_MESSAGES.tooManyReferences}</p>}
        {videos.length === 0 ? (
          <p className={cx(TEXT, "text-ed-muted")}>{W.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ed-line rounded-md border border-ed-line">
            {videos.map((video) => (
              <Upload key={video.id} video={video} added={inStyle.has(video.url)} disabled={full || adding !== null} onAdd={() => void addOne(video)} />
            ))}
          </ul>
        )}
        <p className="text-xs text-ed-muted">{W.note}</p>
      </div>
    );
  }

  return (
    <Dialog title={W.title} open={open} onClose={onClose}>
      {body}
    </Dialog>
  );
}
