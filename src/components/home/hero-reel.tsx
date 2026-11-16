"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/ui/logo";

// The first screen: a real recording of the editor fills it, and the headline over it changes with the recording.
// "The video editor for AI agents" while an agent edits, "for teams" while a teammate does, and so on. Each clip plays
// once and hands over to the next; the tabs under the headline show which one is on and jump to any of them.

export type Slide = {
  key: string;
  src: string;
  poster: string;
  phrase: string; // finishes "The video editor …"
  tab: string;
  line: string;
  label: string; // what the recording shows, for people who can't see it
};

const STILL_HOLD_MS = 6000; // how long each slide stays when the recordings don't play (reduced motion)

export function HeroReel({ slides, closedBeta }: { slides: Slide[]; closedBeta: boolean }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 through the active slide
  const videos = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Play the active recording from its start; hold the others on their first frame.
  useEffect(() => {
    videos.current.forEach((video, i) => {
      if (!video) return;
      if (i !== active) {
        video.pause();
        video.currentTime = 0;
      } else if (!paused && !still) {
        video.play()?.catch(() => {}); // a browser that won't autoplay keeps the poster
      } else {
        video.pause();
      }
    });
  }, [active, paused, still]);

  // Without playing recordings the slides still change, on a timer.
  useEffect(() => {
    if (!still || paused) return;
    const t = window.setTimeout(() => setActive((i) => (i + 1) % slides.length), STILL_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [still, paused, active, slides.length]);

  const go = (i: number) => {
    setProgress(0);
    setActive(i);
  };
  const slide = slides[active];

  return (
    <section className="h-hero" aria-labelledby="home-title">
      <div className="h-heroMedia">
        {slides.map((s, i) => (
          <video
            key={s.key}
            ref={(el) => {
              videos.current[i] = el;
            }}
            className="h-heroVideo"
            data-on={i === active || undefined}
            src={s.src}
            poster={s.poster}
            muted
            playsInline
            preload={i === active || i === (active + 1) % slides.length ? "auto" : "metadata"}
            aria-label={s.label}
            aria-hidden={i === active ? undefined : true}
            onTimeUpdate={(e) => {
              if (i === active) setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1));
            }}
            onEnded={() => {
              if (i === active) go((active + 1) % slides.length);
            }}
          />
        ))}
        <div className="h-heroScrim" />
      </div>

      <header className="h-nav">
        <Link href="/" className="h-brand" aria-label="EasyEdit home">
          <LogoMark size={26} />
          <span>EasyEdit</span>
        </Link>
        <nav aria-label="On this page" className="h-navLinks">
          <a href="#ai">AI agents</a>
          <a href="#teams">Teams</a>
          <a href="#start">Get started</a>
        </nav>
        <div className="h-navActions">
          <Link href="/login" className="h-navSignIn">
            Sign in
          </Link>
          {!closedBeta && (
            <Link href="/login" className="h-btn h-btnSmall">
              Start free
            </Link>
          )}
        </div>
      </header>

      <div className="h-heroText">
        <h1 id="home-title" className="h-heroTitle">
          <span className="h-sr">The video editor for AI agents and teams</span>
          <span aria-hidden="true">The video editor</span>
          <span aria-hidden="true" className="h-heroPhrase">
            {slides.map((s, i) => (
              <span key={s.key} data-on={i === active || undefined}>
                {s.phrase}
              </span>
            ))}
          </span>
        </h1>
        <p className="h-heroLine" aria-live="off">
          {slide.line}
        </p>
        <div className="h-heroActions">
          <Link href="/login" className="h-btn">
            {closedBeta ? "Sign in" : "Start editing, free"}
          </Link>
          <a href="#ai" className="h-btn h-btnGhost">
            See it work
          </a>
        </div>
        {closedBeta && <p className="h-heroNote">EasyEdit is in closed beta. Sign-in is by invitation only for now.</p>}
      </div>

      <div className="h-heroTabs" role="group" aria-label="What the recording shows">
        {slides.map((s, i) => (
          <button key={s.key} type="button" aria-pressed={i === active} onClick={() => go(i)} className="h-heroTab">
            <span className="h-heroTabBar">
              <span style={{ transform: `scaleX(${i === active ? (still ? 1 : progress) : i < active ? 1 : 0})` }} />
            </span>
            {s.tab}
          </button>
        ))}
        {!still && (
          <button type="button" className="h-heroPause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? "Play" : "Pause"}
          </button>
        )}
      </div>
    </section>
  );
}
