"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { TUTORIAL_CAPTIONS, TUTORIAL_CHAPTERS } from "@/lib/tutorial/script";
import { chapterAt, clock } from "@/lib/tutorial/timing";
import type { TutorialVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

export type TutorialDialogProps = {
  open: boolean;
  video: TutorialVideo;
  firstVisit: boolean; // opened by itself on a first visit, so skipping is offered; false from the menu
  onClose(): void;
  onWatched?(): void; // the first time it plays in an opening
};

// The intro tutorial: the video, with its chapters beside it. Every opening starts from the beginning: the player
// below is mounted afresh each time the dialog opens, as the New project form is.
export function TutorialDialog(props: TutorialDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <Tutorial key={openings} {...props} />;
}

// It never starts by itself: browsers refuse a video that plays sound unasked, and a person may be somewhere quiet.
// Watch, a chapter, or the player's own button starts it. A play the browser refuses is left alone; the person can
// press the player's button.
function Tutorial({ open, video, firstVisit, onClose, onWatched }: TutorialDialogProps): ReactNode {
  const player = useRef<HTMLVideoElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chapter, setChapter] = useState(0);

  // A video can fail before this component is listening (the browser starts loading as soon as it sees the tag), so
  // the player is asked once whether it already has.
  useEffect(() => {
    if (open && player.current?.error) setFailed(true);
  }, [open]);
  // The button that had the keyboard (Watch) is gone once the video fails; Done takes it, so it is not left nowhere.
  useEffect(() => {
    if (failed) done.current?.focus();
  }, [failed]);

  // The narration as captions the player can show and hide. Added once per player; a browser without cues skips it.
  const captioned = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = player.current;
    if (!open || !element || captioned.current === element || typeof VTTCue === "undefined" || !element.addTextTrack) return;
    captioned.current = element;
    const track = element.addTextTrack("captions", "English", "en");
    for (const line of TUTORIAL_CAPTIONS) track.addCue(new VTTCue(line.start, line.end, line.text));
    track.mode = "showing";
  }, [open]);

  function play(from?: number) {
    const element = player.current;
    if (!element) return;
    if (from !== undefined) element.currentTime = from;
    void element.play().catch(() => {});
  }

  function onPlay() {
    if (started) return;
    setStarted(true);
    onWatched?.();
  }

  // Watch hands the keyboard to the player, so Space pauses the video. Left on the foot's button it would go to Done,
  // which replaces Watch once the video plays, and Space would close the dialog.
  function watch() {
    play();
    player.current?.focus();
  }

  const footer =
    started || failed ? (
      <Button ref={done} onClick={onClose}>
        {TUTORIAL_WORDS.done}
      </Button>
    ) : (
      <>
        {firstVisit && (
          <Button variant="ghost" onClick={onClose}>
            {TUTORIAL_WORDS.skip}
          </Button>
        )}
        <Button variant="primary" data-autofocus onClick={watch}>
          {TUTORIAL_WORDS.watch}
        </Button>
      </>
    );

  return (
    <Dialog title={TUTORIAL_WORDS.title} open={open} onClose={onClose} size="lg" footer={footer}>
      <div className="flex min-h-full flex-col gap-4 md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-ed-muted">{TUTORIAL_WORDS.intro}</p>
          {failed ? (
            <p role="alert" className="rounded-md border border-ed-line bg-ed-raised p-4 text-ed-text">
              {TUTORIAL_WORDS.failed}
            </p>
          ) : (
            <video
              ref={player}
              src={video.url}
              poster={video.poster}
              aria-label={TUTORIAL_WORDS.video}
              tabIndex={0}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-md border border-ed-line bg-black"
              onPlay={onPlay}
              onTimeUpdate={(event) => setChapter(chapterAt(event.currentTarget.currentTime))}
              onError={() => setFailed(true)}
            />
          )}
        </div>
        <nav aria-label={TUTORIAL_WORDS.chapters} className="flex shrink-0 flex-col gap-1 md:w-56">
          <h3 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-ed-muted uppercase">{TUTORIAL_WORDS.chapters}</h3>
          <ol className="flex flex-col gap-0.5">
            {TUTORIAL_CHAPTERS.map((entry, index) => (
              <li key={entry.title}>
                <button
                  type="button"
                  disabled={failed}
                  aria-current={index === chapter ? "true" : undefined}
                  className={cx(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium disabled:opacity-40",
                    index === chapter ? "bg-ed-accent-weak text-ed-accent" : "text-ed-text hover:bg-ed-hover",
                    FOCUS_RING_INSET,
                    FADE,
                  )}
                  onClick={() => play(entry.start)}
                >
                  <span className="w-4 shrink-0 text-ed-muted tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="shrink-0 text-ed-muted tabular-nums">{clock(entry.start)}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </Dialog>
  );
}
