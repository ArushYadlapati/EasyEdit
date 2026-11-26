"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LessonMeta } from "@/components/dashboard/lesson-meta";
import { LessonPlayer, type LessonPlayerHandle } from "@/components/dashboard/lesson-player";
import { Button } from "@/components/ui/button";
import { linkButtonClass } from "@/components/ui/button-class";
import { Dialog } from "@/components/ui/dialog";
import type { Lesson } from "@/lib/tutorial/lesson";
import type { TutorialVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

export type TutorialDialogProps = {
  open: boolean;
  video: TutorialVideo;
  lesson: Lesson; // the guide's first lesson
  credit: string | null; // what the videos' voice asks to be credited as
  firstVisit: boolean; // the person has yet to see it, so skipping is offered
  onClose(): void;
  onWatched?(): void; // the first time it plays in an opening
};

// The welcome dialog: the guide's first lesson, shown once to someone who has not seen it (account-menu.tsx opens
// it). Every opening starts from the beginning: the player below is mounted afresh each time the dialog opens, as
// the New project form is.
export function TutorialDialog(props: TutorialDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <Welcome key={openings} {...props} />;
}

// The welcome: the first lesson's player with a word of what it is, and a foot that offers Watch (and Skip for now
// on a first visit) until the video plays, then the way to the rest of the guide and Done.
function Welcome({ open, video, lesson, credit, firstVisit, onClose, onWatched }: TutorialDialogProps): ReactNode {
  const player = useRef<LessonPlayerHandle>(null);
  const done = useRef<HTMLButtonElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  // The button that had the keyboard (Watch) is gone once the video fails; Done takes it, so it is not left nowhere.
  useEffect(() => {
    if (failed) done.current?.focus();
  }, [failed]);

  // Watch hands the keyboard to the player, so Space pauses the video. Left on the foot's button it would go to Done,
  // which replaces Watch once the video plays, and Space would close the dialog.
  function watch() {
    player.current?.play();
    player.current?.focus();
  }

  const footer =
    started || failed ? (
      <>
        {/* The rest of the guide is a page; going there closes the welcome like Done does. */}
        <Link href="/learn" className={linkButtonClass("default")} onClick={onClose}>
          {TUTORIAL_WORDS.allLessons}
        </Link>
        <Button ref={done} onClick={onClose}>
          {TUTORIAL_WORDS.done}
        </Button>
      </>
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
      {/* The picture is kept to a width that leaves the chapters and the foot in view without scrolling. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">{lesson.title}</h3>
          <LessonMeta seconds={lesson.seconds} credit={credit} />
        </div>
        <p className="text-[13px] leading-5 text-ed-muted">{TUTORIAL_WORDS.intro}</p>
        <LessonPlayer
          ref={player}
          lesson={lesson}
          video={video}
          onStarted={() => {
            setStarted(true);
            onWatched?.();
          }}
          onFailed={() => setFailed(true)}
        />
      </div>
    </Dialog>
  );
}
