"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/ui/logo";

// The first screen: a full-screen model of the editor, in the editor's own colours, with a headline over it.
// Every few seconds it moves to the next scene and the headline's ending changes with it: Claude adding a title
// ("for AI agents"), a teammate's selection ("for teams"), a project going vertical for Reels ("for creators"),
// an export finishing ("in your browser"). The moments inside a scene are CSS animations that restart because each
// scene's overlay is keyed by the scene, so the only timer is the one that changes scenes.
// The footage is from Pexels (free to use, no credit required).

const SCENE_MS = 4000;

type Scene = { key: string; phrase: string; line: string; video: string; poster: string };

const SCENES: Scene[] = [
  {
    key: "ai",
    phrase: "for AI agents.",
    line: "Ask Claude, ChatGPT or Cursor in plain words, and watch the edit land in your project.",
    video: "/home/scene-laugh.mp4",
    poster: "/home/scene-laugh.jpg",
  },
  {
    key: "team",
    phrase: "for teams.",
    line: "Everyone edits the same project at once, and sees who's working on what.",
    video: "/home/scene-city.mp4",
    poster: "/home/scene-city.jpg",
  },
  {
    key: "creators",
    phrase: "for creators.",
    line: "Vertical, square or wide: make it once and shape it for Reels, Shorts, TikTok or YouTube.",
    video: "/home/scene-mountain.mp4",
    poster: "/home/scene-mountain.jpg",
  },
  {
    key: "browser",
    phrase: "in your browser.",
    line: "Nothing to install. Your video renders to an MP4 right on your computer.",
    video: "/home/scene-wave.mp4",
    poster: "/home/scene-wave.jpg",
  },
];

const MEDIA = [
  { name: "laugh.mp4", img: "/home/scene-laugh.jpg" },
  { name: "shibuya.mp4", img: "/home/scene-city.jpg" },
  { name: "ridge.mp4", img: "/home/scene-mountain.jpg" },
  { name: "wave.mp4", img: "/home/scene-wave.jpg" },
  { name: "beach-dog.mp4", img: "/home/still-dog.jpg" },
  { name: "surf.mp4", img: "/home/still-surf.jpg" },
];

const ACTIVITY: Record<string, { who: string; what: string }> = {
  ai: { who: "Claude (for you)", what: "Added text" },
  team: { who: "Sam Okafor", what: "Added a video clip" },
  creators: { who: "You", what: "Changed the format to Vertical 9:16" },
  browser: { who: "You", what: "Trimmed a video clip" },
};

export function HeroScene({ closedBeta }: { closedBeta: boolean }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => setActive((i) => (i + 1) % SCENES.length), still ? SCENE_MS * 2 : SCENE_MS);
    return () => window.clearTimeout(t);
  }, [active, paused, still]);

  useEffect(() => {
    videos.current.forEach((video, i) => {
      if (!video) return;
      if (i === active && !paused && !still) {
        video.currentTime = 0;
        video.play()?.catch(() => {}); // a browser that won't autoplay keeps the poster
      } else {
        video.pause();
      }
    });
  }, [active, paused, still]);

  const scene = SCENES[active];
  const activity = ACTIVITY[scene.key];

  return (
    <section className="h-hero" aria-labelledby="home-title" data-scene={scene.key}>
      {/* The editor model: decoration for sighted visitors; the headline says what it shows. */}
      <div className="h-ed" data-ui aria-hidden="true">
        <div className="h-edBar">
          <LogoMark size={18} />
          <span className="h-edMenu">Projects</span>
          <span className="h-edMenu">Edit</span>
          <span className="h-edMenu">View</span>
          <span className="h-edProject">Summer reel</span>
          <span className="h-edRight">
            {scene.key === "team" && <span className="h-edAvatar">SO</span>}
            <span key={scene.key} className="h-edStatus">
              {scene.key === "ai" && (
                <span className="h-edWorking">
                  <span className="h-edDot" /> Claude is editing…
                </span>
              )}
              {scene.key === "team" && (
                <span className="h-edWorking">
                  <span className="h-edDot" /> Sam Okafor is editing…
                </span>
              )}
              <span className="h-edSaved">Saved</span>
            </span>
            <span className="h-edExport">Export</span>
          </span>
        </div>

        <div className="h-edBody">
          <div className="h-edLeft">
            <div className="h-edTabs">
              <span>Text</span>
              <span data-on>Media</span>
              <span>Brand kit</span>
            </div>
            <div className="h-edMedia">
              {MEDIA.map((m) => (
                <span key={m.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a thumbnail in a drawn interface */}
                  <img src={m.img} alt="" width={160} height={90} />
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          <div className="h-edStage">
            <div className="h-edFrame" data-vertical={scene.key === "creators" || undefined}>
              {SCENES.map((s, i) => (
                <video
                  key={s.key}
                  ref={(el) => {
                    videos.current[i] = el;
                  }}
                  className="h-edVideo"
                  data-on={i === active || undefined}
                  src={s.video}
                  poster={s.poster}
                  muted
                  loop
                  playsInline
                  preload={i === active || i === (active + 1) % SCENES.length ? "auto" : "metadata"}
                />
              ))}
              <div key={scene.key} className="h-edOverlay">
                {scene.key === "ai" && <span className="h-edTitle h-edTitleNew">Take two.</span>}
                {scene.key === "team" && (
                  <span className="h-edPeer">
                    <span>Sam</span>
                  </span>
                )}
                {scene.key === "creators" && <span className="h-edTitle">Into the hills</span>}
              </div>
            </div>
            {scene.key === "browser" && (
              <div key="export" className="h-edDialog">
                <p className="h-edDialogTitle">Export</p>
                <div className="h-edRendering">
                  <p>Rendering… frame by frame, on this computer</p>
                  <span className="h-edProgress">
                    <span />
                  </span>
                </div>
                <div className="h-edReady">
                  <p className="h-edReadyTitle">Your video is ready.</p>
                  <p>summer-reel.mp4 · 14.2 MB</p>
                  <span className="h-edDownload">Download</span>
                </div>
              </div>
            )}
          </div>

          <div className="h-edRight">
            <div className="h-edTabs">
              <span data-on={scene.key === "creators" || undefined}>Inspect</span>
              <span data-on={scene.key !== "creators" || undefined}>Activity</span>
            </div>
            {scene.key === "creators" ? (
              <div className="h-edInspect">
                <p className="h-edLabel">Format</p>
                <p className="h-edField">Vertical 9:16 (1080 × 1920)</p>
                <p className="h-edLabel">Frame rate</p>
                <p>30 fps</p>
                <p className="h-edLabel">Length</p>
                <p>0:24:00</p>
              </div>
            ) : (
              <ol className="h-edActivity">
                <li key={scene.key} className="h-edFresh">
                  <span>
                    {activity.who} · {activity.what}
                  </span>
                  <span className="h-edWhen">
                    just now <span className="h-edUndo">Undo this change</span>
                  </span>
                </li>
                <li>
                  <span>You · Added 4 clips</span>
                  <span className="h-edWhen">2 minutes ago</span>
                </li>
                <li>
                  <span>You · Added an audio clip</span>
                  <span className="h-edWhen">3 minutes ago</span>
                </li>
              </ol>
            )}
          </div>
        </div>

        <div className="h-edTimeline">
          <div className="h-edRuler">
            {Array.from({ length: 13 }, (_, s) => (
              <span key={s}>{`0:${String(s * 2).padStart(2, "0")}`}</span>
            ))}
          </div>
          <div className="h-edTrack">
            <span className="h-edTrackName">Text 1</span>
            <span className="h-edLane">
              <span className="h-edClip h-edClipText" style={{ left: "1%", width: "12%" }} data-fresh={scene.key === "ai" || undefined}>
                Take two.
              </span>
              <span className="h-edClip h-edClipText" style={{ left: "51%", width: "14%" }}>
                Into the hills
              </span>
            </span>
          </div>
          <div className="h-edTrack">
            <span className="h-edTrackName">Video 1</span>
            <span className="h-edLane">
              {SCENES.map((s, i) => (
                <span
                  key={s.key}
                  className="h-edClip"
                  style={{ left: `${i * 25}%`, width: "24.6%" }}
                  data-peer={(s.key === "team" && scene.key === "team") || undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a clip thumbnail in a drawn interface */}
                  <img src={s.poster} alt="" width={64} height={36} />
                  {MEDIA[i].name}
                  {s.key === "team" && scene.key === "team" && <span className="h-edBadge">SO</span>}
                </span>
              ))}
            </span>
          </div>
          <div className="h-edTrack">
            <span className="h-edTrackName">Audio 1</span>
            <span className="h-edLane">
              <span className="h-edClip h-edClipAudio" style={{ left: "0%", width: "99.6%" }}>
                soundtrack.mp3
              </span>
            </span>
          </div>
          <span key={scene.key} className="h-edPlayhead" style={{ "--from": active * 25 + 1, "--to": active * 25 + 24 } as React.CSSProperties} />
        </div>
      </div>
      <div className="h-heroScrim" />

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
          <span className="h-sr">The video editor for AI agents, teams and creators, in your browser</span>
          <span aria-hidden="true">The video editor</span>
          <span aria-hidden="true" className="h-heroPhrase">
            {SCENES.map((s, i) => (
              <span key={s.key} data-on={i === active || undefined}>
                {s.phrase}
              </span>
            ))}
          </span>
        </h1>
        <p className="h-heroLine">{scene.line}</p>
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

      {!still && (
        <button type="button" className="h-heroPause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? "Play" : "Pause"}
        </button>
      )}
    </section>
  );
}
