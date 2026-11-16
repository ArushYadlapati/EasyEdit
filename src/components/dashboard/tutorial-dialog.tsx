"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TutorialPlayer, type TutorialPlayerHandle } from "@/components/dashboard/tutorial-player";
import type { TutorialVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

export type TutorialDialogProps = {
  open: boolean;
  video: TutorialVideo;
  firstVisit: boolean; // the person has yet to see it, so skipping is offered
  onClose(): void;
  onWatched?(): void; // the first time it plays in an opening
};

// The welcome dialog: the intro tutorial, shown once to someone who has not seen it (account-menu.tsx opens it).
// Every opening starts from the beginning: the player below is mounted afresh each time the dialog opens, as the
// New project form is.
export function TutorialDialog(props: TutorialDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <Tutorial key={openings} {...props} />;
}

// The welcome: the tutorial's player with a word of what it is, and a foot that offers Watch (and Skip for now on a
// first visit) until the video plays, then Done.
function Tutorial({ open, video, firstVisit, onClose, onWatched }: TutorialDialogProps): ReactNode {
  const player = useRef<TutorialPlayerHandle>(null);
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
      <div className="flex flex-col gap-3">
        <p className="text-ed-muted">{TUTORIAL_WORDS.intro}</p>
        <TutorialPlayer
          ref={player}
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
