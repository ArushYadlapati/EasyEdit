"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./home.module.css";

export type StageClip = {
  key: string;
  src: string;
  poster: string;
  status: string; // the editor's own words for the moment, set large under the picture
  caption: string;
  label: string; // what the recording shows, for people who can't see it
};

// The half of the page that holds still: real recordings of the editor, one at a time, with a slow crossfade.
// "cycle" plays each clip once and moves to the next (the first screen). "follow" shows the clip of whichever
// [data-stage] block is in the middle of the window (the reading column beside it).
export function Stage({ clips, mode, className }: { clips: StageClip[]; mode: "cycle" | "follow"; className?: string }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [still, setStill] = useState(false); // prefers-reduced-motion: posters only
  const root = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Only play while the stage is on screen and the tab is showing.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return; // no observer (tests): stays on its poster
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    const onHide = () => setVisible(!document.hidden && el.getBoundingClientRect().bottom > 0);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    if (mode !== "follow" || typeof IntersectionObserver === "undefined") return;
    const blocks = [...document.querySelectorAll<HTMLElement>("[data-stage]")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = clips.findIndex((c) => c.key === (entry.target as HTMLElement).dataset.stage);
          if (i >= 0) setActive(i);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    blocks.forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, [mode, clips]);

  useEffect(() => {
    videos.current.forEach((video, i) => {
      if (!video) return;
      if (i === active && visible && !paused && !still) {
        if (mode === "cycle" && video.ended) video.currentTime = 0;
        // play() refuses quietly when the browser won't autoplay; the poster stays.
        video.play()?.catch(() => {});
      } else {
        video.pause();
        if (i !== active) video.currentTime = 0;
      }
    });
  }, [active, visible, paused, still, mode]);

  const next = () => setActive((i) => (i + 1) % clips.length);

  return (
    <div ref={root} className={`${styles.stage} ${className ?? ""}`} data-still={still || undefined}>
      <div className={styles.stageScreen}>
        {clips.map((clip, i) => (
          <video
            key={clip.key}
            ref={(el) => {
              videos.current[i] = el;
            }}
            className={styles.stageVideo}
            data-on={i === active || undefined}
            src={clip.src}
            poster={clip.poster}
            muted
            playsInline
            loop={mode === "follow"}
            preload={i === 0 ? "auto" : "metadata"}
            aria-label={clip.label}
            aria-hidden={i === active ? undefined : true}
            onEnded={mode === "cycle" ? next : undefined}
          />
        ))}
      </div>
      <div className={styles.stageWords} aria-live="off">
        {clips.map((clip, i) => (
          <div key={clip.key} className={styles.stageLine} data-on={i === active || undefined} aria-hidden={i === active ? undefined : true}>
            <p className={styles.stageStatus}>{clip.status}</p>
            <p className={styles.stageCaption}>{clip.caption}</p>
          </div>
        ))}
      </div>
      {!still && (
        <button type="button" className={styles.stagePause} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? "Play" : "Pause"}
        </button>
      )}
    </div>
  );
}
