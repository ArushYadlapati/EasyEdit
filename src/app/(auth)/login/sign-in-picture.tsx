"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LogoMark } from "@/components/ui/logo";

// Beside the sign-in on a computer: a drawn editor window playing real footage of the ocean on a loop (Pexels, free to
// use, no credit required), with a title on it that an AI agent has selected (Codex, in its own colour), the way the
// home page draws its pictures. The picture only shows what comes next, so it is hidden from screen readers, and it is
// left out on a phone, where the sign-in is the whole page.
//
// It moves on its own, so it has a Pause of its own, outside the hidden picture so the keyboard and screen readers can
// reach it. When reduced motion is asked for it holds still on its poster and the Pause isn't shown (CSS hides it before
// this script runs). The words on the button say what a press does; they change, so it is a plain button, never also
// marked pressed.

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

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

export function SignInPicture() {
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const still = useSyncExternalStore<boolean | null>(subscribe, askedForStillness, notKnownYet);

  useEffect(() => {
    const clip = video.current;
    if (!clip || still === null) return;
    if (still || paused) clip.pause();
    else clip.play()?.catch(() => {}); // a browser that won't autoplay keeps the poster
  }, [still, paused]);

  return (
    <div className="h-signPictureCell">
      <figure data-ui aria-hidden className="h-signPicture ed-theme">
        <div className="h-signBar">
          <LogoMark size={16} />
          <span className="h-signProject">Untitled project</span>
          <span className="h-signSaved">Saved</span>
          <span className="h-signExport">Export</span>
        </div>
        <div className="h-signStage">
          <div className="h-signFrame">
            <video
              ref={video}
              className="h-signStill"
              src="/home/scene-wave.mp4"
              poster="/home/scene-wave.webp"
              width={1280}
              height={720}
              muted
              loop
              playsInline
              preload={still === false ? "auto" : "none"}
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
      </figure>
      {still === false && (
        <button type="button" className="h-signPause" onClick={() => setPaused((p) => !p)}>
          {paused ? "Play" : "Pause"}
          <span className="h-sr"> the ocean video</span>
        </button>
      )}
    </div>
  );
}
