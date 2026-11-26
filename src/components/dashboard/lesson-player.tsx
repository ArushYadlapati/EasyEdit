"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import type { Lesson } from "@/lib/tutorial/lesson";
import { chapterAt, chapterEnd, clock } from "@/lib/tutorial/timing";
import type { TutorialVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

// What whoever holds the player can ask of it: play (from a moment, or from where it is), and take the keyboard.
export type LessonPlayerHandle = { play(from?: number): void; focus(): void };

export type LessonPlayerProps = {
  lesson: Lesson;
  video: TutorialVideo;
  startAt?: number; // seconds: where the video stands before it is first played
  ref?: Ref<LessonPlayerHandle>;
  onStarted?(): void; // the first time it plays
  onFailed?(): void; // the video could not load
  onTime?(seconds: number): void; // as it plays, and when it is moved
};

// One lesson of the guide: its video with the narration as captions, and under it the lesson's chapters as a strip,
// each as wide as its share of the video (a list on a narrow window). The welcome dialog and the Learn page both
// show this. It never starts by itself: browsers refuse a video that plays sound unasked, and a person may be
// somewhere quiet. A chapter or the player's own button starts it. A play the browser refuses is left alone; the
// person can press the player's button.
export function LessonPlayer({ lesson, video, startAt = 0, ref, onStarted, onFailed, onTime }: LessonPlayerProps): ReactNode {
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chapter, setChapter] = useState(() => chapterAt(startAt, lesson.chapters));

  function play(from?: number) {
    const element = player.current;
    if (!element) return;
    if (from !== undefined) element.currentTime = from;
    void element.play().catch(() => {});
  }
  useImperativeHandle(ref, () => ({ play, focus: () => player.current?.focus() }));

  // A video can fail before this component is listening (the browser starts loading as soon as it sees the tag), so
  // the player is asked once whether it already has. The same goes for knowing its length, which is when it can be
  // stood at the moment a link asked for.
  const stood = useRef(false);
  function standAt(element: HTMLVideoElement) {
    if (stood.current || startAt <= 0) return;
    stood.current = true;
    element.currentTime = startAt;
  }
  useEffect(() => {
    const element = player.current;
    if (!element) return;
    if (element.error) setFailed(true);
    else if (element.readyState >= 1) standAt(element);
    // Only the player as it first stands is asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    for (const line of lesson.captions) track.addCue(new VTTCue(line.start, line.end, line.text));
    track.mode = "showing";
  }, [lesson.captions]);

  function onPlay() {
    if (started) return;
    setStarted(true);
    onStarted?.();
  }
  function onMoved(seconds: number) {
    setChapter(chapterAt(seconds, lesson.chapters));
    onTime?.(seconds);
  }

  return (
    <div className="flex flex-col gap-2">
      {failed ? (
        <p role="alert" className="rounded-md border border-ed-line bg-ed-raised p-4 text-[13px] leading-5 text-ed-text">
          {TUTORIAL_WORDS.failed}
        </p>
      ) : (
        <video
          ref={player}
          src={video.url}
          poster={video.poster}
          aria-label={TUTORIAL_WORDS.video(lesson.title)}
          tabIndex={0}
          controls
          playsInline
          preload="metadata"
          className={cx("aspect-video w-full rounded-md border border-ed-line bg-black", FOCUS_RING_INSET)}
          onPlay={onPlay}
          onLoadedMetadata={(event) => standAt(event.currentTarget)}
          onTimeUpdate={(event) => onMoved(event.currentTarget.currentTime)}
          onSeeked={(event) => onMoved(event.currentTarget.currentTime)}
          onError={() => setFailed(true)}
        />
      )}
      <nav aria-label={TUTORIAL_WORDS.chapters}>
        {/* The hairlines between chapters are the list's own ground showing through one-pixel gaps. */}
        <ol className="flex flex-col gap-px overflow-hidden rounded-md border border-ed-line bg-ed-line sm:flex-row">
          {lesson.chapters.map((entry, index) => {
            const length = Math.max(1, chapterEnd(index, lesson.chapters, lesson.seconds) - entry.start);
            return (
              // In a row a chapter takes the room its name needs, plus its share of what is left by its length.
              <li key={`${index}-${entry.title}`} className="min-w-0" style={{ flex: `${length.toFixed(1)} 1 auto` }}>
                <button
                  type="button"
                  disabled={failed}
                  aria-current={index === chapter ? "true" : undefined}
                  title={`${entry.title} · ${clock(entry.start)}`}
                  className={cx(
                    "flex h-8 w-full min-w-0 items-center gap-2 px-2.5 text-left text-xs font-medium disabled:opacity-40",
                    index === chapter ? "bg-ed-accent-weak text-ed-accent" : "bg-ed-panel text-ed-muted enabled:hover:bg-ed-hover enabled:hover:text-ed-text",
                    FOCUS_RING_INSET,
                    FADE,
                  )}
                  onClick={() => play(entry.start)}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="shrink-0 text-ed-muted tabular-nums sm:hidden">{clock(entry.start)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
