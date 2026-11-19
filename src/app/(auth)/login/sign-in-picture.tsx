"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { LogoMark } from "@/components/ui/logo";

// Beside the sign-in on a computer: a drawn editor window playing real footage of the ocean on a loop (Pexels, free to
// use, no credit required), with a title on it that an AI agent has selected (Codex, in its own colour), and the
// editor's timeline under it: the play/pause button at the start of the ruler, a text track and a video track, and the
// playhead, which follows the footage and can be dragged, or the ruler and tracks clicked, to go to any moment. It is
// left out on a phone, where the sign-in is the whole page.
//
// The window's bar and preview only show what comes next, so they are hidden from screen readers; the button and the
// timeline are real controls. The button's name says what a press does (Pause or Play), so, like the home page's, it
// is not also marked pressed. When reduced motion is asked for the footage doesn't start by itself, but the button and
// the timeline still play and move it.

const CLIP = { src: "/home/scene-wave.mp4", poster: "/home/scene-wave.webp", name: "wave.mp4", seconds: 6 };
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const STEP = 0.5; // seconds an arrow key moves the playhead

// Whether reduced motion is asked for, followed as it changes; null on the server and in the first render, so the clip
// never starts for someone who asked for stillness before it is known.
function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const askedForStillness = () => (typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION).matches : false);
const notKnownYet = () => null;

const timecode = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function SignInPicture() {
  const video = useRef<HTMLVideoElement>(null);
  const playhead = useRef<HTMLSpanElement>(null);
  const still = useSyncExternalStore<boolean | null>(subscribe, askedForStillness, notKnownYet);
  // What the visitor chose with the button; until they choose, the footage plays unless reduced motion is asked for.
  const [chosen, setChosen] = useState<"play" | "pause" | null>(null);
  const playing = chosen === null ? still === false : chosen === "play";
  // The footage's place, for the timeline's slider and its spoken value; the playhead itself is moved every frame.
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(CLIP.seconds);

  useEffect(() => {
    const clip = video.current;
    if (!clip || still === null) return;
    if (playing) clip.play()?.catch(() => {}); // a browser that won't autoplay keeps the poster
    else clip.pause();
  }, [still, playing]);

  // The playhead follows the footage frame by frame, read from the footage itself (its timeupdate events can come late
  // after a seek). The slider's value follows to the tenth of a second, so it is spoken as it really is.
  useEffect(() => {
    const clip = video.current;
    if (!clip) return;
    let frame = 0;
    let tenth = -1;
    const draw = () => {
      const now = clip.currentTime;
      const at = clip.duration > 0 ? now / clip.duration : 0;
      playhead.current?.style.setProperty("--at", String(at));
      if (Math.round(now * 10) !== tenth) {
        tenth = Math.round(now * 10);
        setTime(now);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  function seek(seconds: number) {
    const clip = video.current;
    if (!clip) return;
    const to = clamp(seconds, 0, length);
    clip.currentTime = to;
    setTime(to);
  }

  // A press anywhere on the ruler or the tracks goes to that moment, and dragging keeps going.
  function seekToPointer(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) seek(((event.clientX - box.left) / box.width) * length);
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToPointer(event);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) seekToPointer(event);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowLeft: -STEP, ArrowDown: -STEP, ArrowRight: STEP, ArrowUp: STEP, PageDown: -1, PageUp: 1 };
    const now = video.current?.currentTime ?? time;
    if (event.key in moves) seek(now + moves[event.key]);
    else if (event.key === "Home") seek(0);
    else if (event.key === "End") seek(length);
    else return;
    event.preventDefault();
  }

  return (
    <div className="h-signPictureCell">
      <div data-ui className="h-signPicture ed-theme">
        <div className="h-signBar" aria-hidden="true">
          <LogoMark size={16} />
          <span className="h-signProject">Untitled project</span>
          <span className="h-signSaved">Saved</span>
          <span className="h-signExport">Export</span>
        </div>
        <div className="h-signStage" aria-hidden="true">
          <div className="h-signFrame">
            <video
              ref={video}
              className="h-signStill"
              src={CLIP.src}
              poster={CLIP.poster}
              width={1280}
              height={720}
              muted
              loop
              playsInline
              preload={still === false ? "auto" : "metadata"}
              onLoadedMetadata={(e) => {
                if (e.currentTarget.duration > 0) setLength(e.currentTarget.duration);
              }}
            />
            <span className="h-signTitle">
              Your next video
              <span className="h-signSel">
                <span className="h-signTag">Codex</span>
                <span className="h-signHandle" data-at="tl" />
                <span className="h-signHandle" data-at="tr" />
                <span className="h-signHandle" data-at="bl" />
                <span className="h-signHandle" data-at="br" />
              </span>
            </span>
          </div>
        </div>
        <div className="h-signTimeline">
          <button
            type="button"
            className="h-signPlay"
            aria-label={playing ? "Pause the ocean video" : "Play the ocean video"}
            title={playing ? "Pause" : "Play"}
            onClick={() => setChosen(playing ? "pause" : "play")}
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <div className="h-signRuler" aria-hidden="true">
            {Array.from({ length: CLIP.seconds + 1 }, (_, s) => (
              <span key={s}>{timecode(s)}</span>
            ))}
          </div>
          <div className="h-signTrack" aria-hidden="true">
            <span className="h-signTrackName">Text 1</span>
            <span className="h-signLane">
              <span className="h-signClip h-signClipText">Your next video</span>
            </span>
          </div>
          <div className="h-signTrack" aria-hidden="true">
            <span className="h-signTrackName">Video 1</span>
            <span className="h-signLane">
              <span className="h-signClip">
                {/* eslint-disable-next-line @next/next/no-img-element -- a clip thumbnail in a drawn interface */}
                <img src={CLIP.poster} alt="" width={64} height={36} />
                {CLIP.name}
              </span>
            </span>
          </div>
          {/* The ruler and the tracks are one place to scrub: a press or a drag goes to that moment. */}
          <div
            className="h-signScrub"
            role="slider"
            tabIndex={0}
            aria-label="Moment in the ocean video"
            aria-valuemin={0}
            aria-valuemax={Math.round(length * 10) / 10}
            aria-valuenow={Math.round(time * 10) / 10}
            aria-valuetext={`${timecode(time)} of ${timecode(length)}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onKeyDown={onKeyDown}
          >
            <span ref={playhead} className="h-signPlayhead" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
