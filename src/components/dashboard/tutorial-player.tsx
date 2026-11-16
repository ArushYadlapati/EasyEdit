"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { TUTORIAL_CAPTIONS, TUTORIAL_CHAPTERS } from "@/lib/tutorial/script";
import { chapterAt, clock } from "@/lib/tutorial/timing";
import type { TutorialVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

// What whoever holds the player can ask of it: start it, and give it the keyboard.
export type TutorialPlayerHandle = { play(): void; focus(): void };

export type TutorialPlayerProps = {
  video: TutorialVideo;
  ref?: Ref<TutorialPlayerHandle>;
  onStarted?(): void; // the first time it plays
  onFailed?(): void; // the video could not load
};

// The intro tutorial itself: the video, its chapters beside it (under it on a narrow window), and the narration as
// captions. The welcome dialog and the Learn page both show this. It never starts by itself: browsers refuse a
// video that plays sound unasked, and a person may be somewhere quiet. A chapter or the player's own button starts
// it. A play the browser refuses is left alone; the person can press the player's button.
export function TutorialPlayer({ video, ref, onStarted, onFailed }: TutorialPlayerProps): ReactNode {
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chapter, setChapter] = useState(0);

  function play(from?: number) {
    const element = player.current;
    if (!element) return;
    if (from !== undefined) element.currentTime = from;
    void element.play().catch(() => {});
  }
  useImperativeHandle(ref, () => ({ play: () => play(), focus: () => player.current?.focus() }));

  // A video can fail before this component is listening (the browser starts loading as soon as it sees the tag), so
  // the player is asked once whether it already has.
  useEffect(() => {
    if (player.current?.error) setFailed(true);
  }, []);
  // Whoever holds the player is told once that it failed, however that was found out.
  const told = useRef(false);
  useEffect(() => {
    if (!failed || told.current) return;
    told.current = true;
    onFailed?.();
  }, [failed, onFailed]);

  // The narration as captions the player can show and hide. Added once per player; a browser without cues skips it.
  const captioned = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = player.current;
    if (!element || captioned.current === element || typeof VTTCue === "undefined" || !element.addTextTrack) return;
    captioned.current = element;
    const track = element.addTextTrack("captions", "English", "en");
    for (const line of TUTORIAL_CAPTIONS) track.addCue(new VTTCue(line.start, line.end, line.text));
    track.mode = "showing";
  }, []);

  function onPlay() {
    if (started) return;
    setStarted(true);
    onStarted?.();
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="min-w-0 flex-1">
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
  );
}
