"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PlatformOverlay } from "@/components/editor/platform-overlay";
import { LogoMark } from "@/components/ui/logo";
import { platformViewsFor, type PlatformView } from "@/lib/editor/platform-views";

// The first screen: the headline across the top, then a model of the editor, in the editor's own colours, under it.
// The headline's second line is a text clip with its author's selection around it. Every few seconds the hero moves
// to the next scene: the next author deletes the old ending and types theirs ("for AI agents." by Claude, "for teams."
// by a teammate, "for creators." and "in your browser." by you), while the editor below shows that scene: Claude
// adding a title, a teammate's selection, a project going vertical for Reels, an export finishing. The moments inside
// a scene are CSS animations that restart because each scene's overlay is keyed by the scene, so the timers are the
// one that changes scenes and the one that types.
// Pause holds all of it where it is: the clip, the moments (home.css stops their animations), the typing and the
// scene's clock, which keeps what is left of the scene so that Play carries on from the same point in each.
// With reduced motion asked for there is no timer: the hero keeps the scene it shows (the first, for anyone who
// arrives that way) with its ending in full, its clips on their posters (none is even downloaded), and home.css shows
// each of the scene's moments as it ends. Allowing motion again starts the shown scene over, its clip, moments and
// clock together.
// The footage is from Pexels (free to use, no credit required).

// Who typed a scene's ending, and the colour their selection has in the editor: Claude's orange, a teammate's own
// colour, or the blue of your own selection.
type Author = { name: string; tone: "claude" | "peer" | "you" };
type Scene = { key: string; ms: number; phrase: string; author: Author; video: string; poster: string };

// Each clip is longer than its scene (the city one is slowed to two-thirds speed to make 9 s), and none loops, so a scene never
// shows its clip jumping back to the start.
const SCENES: Scene[] = [
  {
    key: "ai",
    ms: 5000,
    phrase: "for AI agents.",
    author: { name: "Claude", tone: "claude" },
    video: "/home/scene-friends.mp4",
    poster: "/home/scene-friends.webp",
  },
  {
    key: "team",
    ms: 8500,
    phrase: "for teams.",
    author: { name: "Sam", tone: "peer" },
    video: "/home/scene-city.mp4",
    poster: "/home/scene-city.webp",
  },
  {
    key: "creators",
    ms: 5000,
    phrase: "for creators.",
    author: { name: "You", tone: "you" },
    video: "/home/scene-mountain.mp4",
    poster: "/home/scene-mountain.webp",
  },
  {
    key: "browser",
    ms: 4000,
    phrase: "in your browser.",
    author: { name: "You", tone: "you" },
    video: "/home/scene-wave.mp4",
    poster: "/home/scene-wave.webp",
  },
];

// How long each letter takes, in ms: deleting goes a little faster than typing, as it does at a keyboard.
const DELETE_MS = 24;
const TYPE_MS = 32;

// The next step from what the ending shows to what it should say: delete back to the part the two share ("for "
// stays when "for AI agents." becomes "for teams."), then type the rest one letter at a time.
function nextKeystroke(shown: string, target: string): string {
  let shared = 0;
  while (shared < shown.length && shared < target.length && shown[shared] === target[shared]) shared++;
  return shown.length > shared ? shown.slice(0, -1) : target.slice(0, shown.length + 1);
}

const MEDIA = [
  { name: "bonfire.mp4", img: "/home/scene-friends.webp" },
  { name: "shibuya.mp4", img: "/home/scene-city.webp" },
  { name: "ridge.mp4", img: "/home/scene-mountain.webp" },
  { name: "wave.mp4", img: "/home/scene-wave.webp" },
  { name: "beach-dog.mp4", img: "/home/still-dog.webp" },
  { name: "surf.mp4", img: "/home/still-surf.webp" },
];

// Each scene's new Activity lines (the app's wording, from summarizeOps), and when each arrives, in seconds.
const ACTIVITY: Record<string, { who: string; what: string; at: number }[]> = {
  ai: [
    { who: "Claude (for you)", what: "Added text", at: 1.2 },
    { who: "Claude (for you)", what: "Changed text: position", at: 3.4 },
  ],
  team: [
    { who: "Sam Okafor", what: "Added text", at: 0.7 },
    { who: "Mika Kato", what: "Changed a video clip: position and scale", at: 3.6 },
    { who: "Priya Shah", what: "Changed text: font", at: 4.9 },
    { who: "Leo Park", what: "Changed text: position", at: 7 },
  ],
  creators: [{ who: "You", what: "Changed the format to Vertical 9:16", at: 0.6 }],
  browser: [{ who: "You", what: "Trimmed a video clip", at: 0.3 }],
};

export function HeroScene({ closedBeta }: { closedBeta: boolean }) {
  const [active, setActive] = useState(0);
  // The scene fading out, kept on screen as it ended (its overlay stays mounted, its clip keeps its zoom) for the
  // length of the crossfade, so nothing snaps back while it goes.
  const [leaving, setLeaving] = useState<number | null>(null);
  // What the headline's ending shows while it is being retyped; null once it says the shown scene's ending in full.
  const [typed, setTyped] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // Whether reduced motion is asked for; null until the page has asked the browser, so the timer and the clips wait
  // for the answer instead of starting and then stopping at once.
  const [still, setStill] = useState<boolean | null>(null);
  // How many times the shown scene has been started over (once each time reduced motion is turned off again). The
  // editor is keyed by it, so its moments start again from the beginning.
  const [take, setTake] = useState(0);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  // The scene's clock: which scene and take it is timing, and how many ms of it are left to run.
  const clock = useRef({ active: -1, take: -1, left: 0 });
  // The scene and take whose clip was last started from its first frame.
  const clipFrom = useRef({ active: -1, take: -1 });

  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let was: boolean | null = null;
    const update = () => {
      const reduce = query?.matches ?? false;
      if (was === true && !reduce) setTake((n) => n + 1);
      was = reduce;
      setStill(reduce);
      if (reduce) setTyped(null); // an ending halfway through being retyped shows in full
    };
    update();
    if (!query) return;
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // A new scene, or the scene started over, gets its full length; after a Pause the timer gets only what was left.
  // Turning reduced motion on while the page is open stops the hero on the scene it shows; a crossfade already under
  // way still finishes, through the leaving timer below.
  useEffect(() => {
    if (paused || still !== false) return;
    if (clock.current.active !== active || clock.current.take !== take) {
      clock.current = { active, take, left: SCENES[active].ms };
    }
    const started = performance.now();
    const t = window.setTimeout(() => {
      setLeaving(active);
      setActive((active + 1) % SCENES.length);
      setTyped((now) => now ?? SCENES[active].phrase); // the new author starts from the old ending
    }, clock.current.left);
    return () => {
      window.clearTimeout(t);
      clock.current.left = Math.max(0, clock.current.left - (performance.now() - started));
    };
  }, [active, take, paused, still]);

  useEffect(() => {
    if (leaving === null) return;
    const t = window.setTimeout(() => setLeaving(null), 600);
    return () => window.clearTimeout(t);
  }, [leaving]);

  // One keystroke at a time. Pause holds the ending where it is, halfway or not.
  const target = SCENES[active].phrase;
  useEffect(() => {
    if (typed === null || paused || still !== false) return;
    const next = nextKeystroke(typed, target);
    const deleting = next.length < typed.length;
    const t = window.setTimeout(() => setTyped(next === target ? null : next), deleting ? DELETE_MS : TYPE_MS);
    return () => window.clearTimeout(t);
  }, [typed, target, paused, still]);

  // A scene's clip starts from its first frame when the scene does; Play after a Pause carries on from where it stopped.
  useEffect(() => {
    if (still === null) return;
    videos.current.forEach((video, i) => {
      if (!video) return;
      if (i === active && !paused && !still) {
        if (clipFrom.current.active !== active || clipFrom.current.take !== take) {
          clipFrom.current = { active, take };
          video.currentTime = 0;
        }
        video.play()?.catch(() => {}); // a browser that won't autoplay keeps the poster
      } else {
        video.pause();
      }
    });
  }, [active, take, paused, still]);

  const scene = SCENES[active];
  const fresh = [...ACTIVITY[scene.key]].reverse(); // newest first, as in the app
  const ending = still ? target : (typed ?? target);
  const typing = !still && typed !== null;

  return (
    <section className="h-hero" aria-labelledby="home-title" data-scene={scene.key} data-paused={paused || undefined}>
      <div className="h-heroBand">
        {/* Screen readers get one sentence that stays put: the first line, then the first ending. The ending drawn
            on screen, which is retyped scene by scene, is hidden from them. */}
        <h1 id="home-title" className="h-heroTitle">
          <span className="h-heroFirst">The video editor</span>
          <span className="h-sr"> {SCENES[0].phrase}</span>
          <span className="h-heroEnding" aria-hidden="true">
            <span className="h-heroClip" data-tone={scene.author.tone} data-typing={typing || undefined}>
              {ending || "​"}
              {/* The author's selection around the text clip, as the editor draws it: corner handles and a name tag. */}
              <span className="h-heroBox" data-ui>
                <span className="h-heroHandle" data-at="tl" />
                <span className="h-heroHandle" data-at="tr" />
                <span className="h-heroHandle" data-at="bl" />
                <span className="h-heroHandle" data-at="br" />
                <span className="h-heroTag">{scene.author.name}</span>
              </span>
            </span>
          </span>
        </h1>
        <div className="h-heroSide">
          <p className="h-heroLead">
            Ask Claude, ChatGPT or Cursor in plain words and watch the edit land. It&apos;s free, and your videos stay in
            your own Google Drive.
          </p>
          <div className="h-heroActions">
            <Link href="/login" className="h-btn">
              {closedBeta ? "Sign in" : "Start free"}
            </Link>
            <a href="#ai" className="h-btn h-btnGhost">
              See it edit
            </a>
          </div>
          {closedBeta && <p className="h-heroNote">EasyEdit is in closed beta. Sign-in is by invitation only for now.</p>}
        </div>
      </div>

      {/* Its words say what a press does, so, like the agent logos' button, it is not also marked pressed. It holds the
          scenes, the typing and every moment in the editor below. With reduced motion nothing changes by itself, so
          there is no button (home.css hides it before the script has run too). */}
      {!still && (
        <button type="button" className="h-pause h-heroPause" onClick={() => setPaused((p) => !p)}>
          {paused ? "Play" : "Pause"}
        </button>
      )}

      {/* The editor model: decoration for sighted visitors; the headline says what it shows. */}
      <div key={take} className="h-ed" data-ui aria-hidden="true">
        <div className="h-edBar">
          <LogoMark size={18} />
          <span className="h-edMenu">Projects</span>
          <span className="h-edMenu">Edit</span>
          <span className="h-edMenu">View</span>
          <span className="h-edProject">Summer reel</span>
          <span className="h-edRight">
            {scene.key === "team" && (
              <>
                <span className="h-edAvatar">SO</span>
                <span className="h-edAvatar h-edAvatarMika">MK</span>
                <span className="h-edAvatar h-edAvatarPriya">PS</span>
                <span className="h-edAvatar h-edAvatarLeo">LP</span>
              </>
            )}
            <span key={scene.key} className="h-edStatus" style={{ "--busy": scene.key === "team" ? "7.2s" : "3.6s" } as React.CSSProperties}>
              {scene.key === "ai" && (
                <span className="h-edWorking">
                  <span className="h-edDot" />
                  <span className="h-edWho">Claude is editing…</span>
                </span>
              )}
              {scene.key === "team" && (
                <span className="h-edWorking">
                  <span className="h-edDot" />
                  <span className="h-edWho">Sam Okafor is editing…</span>
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
            <div className="h-edFrame" data-scene={scene.key} data-vertical={scene.key === "creators" || undefined}>
              {SCENES.map((s, i) => (
                <video
                  key={s.key}
                  ref={(el) => {
                    videos.current[i] = el;
                  }}
                  className="h-edVideo"
                  data-key={s.key}
                  data-on={i === active || undefined}
                  data-leaving={i === leaving || undefined}
                  // No clip is fetched until the page knows it may play them: with reduced motion each stays its poster.
                  src={still === false ? s.video : undefined}
                  poster={s.poster}
                  muted
                  playsInline
                  preload={i === active || i === (active + 1) % SCENES.length ? "auto" : "none"}
                />
              ))}
              {[leaving, active]
                .filter((i): i is number => i !== null)
                .map((i) => (
                  <div
                    key={SCENES[i].key}
                    className="h-edOverlay"
                    data-scene={SCENES[i].key}
                    data-leaving={i === leaving || undefined}
                  >
                    <Overlay scene={SCENES[i].key} />
                  </div>
                ))}
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
              <ol key={scene.key} className="h-edActivity">
                {fresh.map((row) => (
                  <li key={row.what} className="h-edFresh" style={{ animationDelay: `${row.at}s` }}>
                    <span>
                      {row.who} · {row.what}
                    </span>
                    <span className="h-edWhen">
                      just now <span className="h-edUndo">Undo this change</span>
                    </span>
                  </li>
                ))}
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
          <span key={`viewas-${scene.key}`} className="h-edViewAs" data-shorts={scene.key === "creators" || undefined}>
            View as:{" "}
            <span className="h-edViewVal">
              <span className="h-edViewOff">Off</span>
              {scene.key === "creators" && <span className="h-edViewOn">YouTube Shorts</span>}
            </span>
          </span>
          <div className="h-edRuler">
            {Array.from({ length: 13 }, (_, s) => (
              <span key={s}>{`0:${String(s * 2).padStart(2, "0")}`}</span>
            ))}
          </div>
          <div className="h-edTrack">
            <span className="h-edTrackName">Text 1</span>
            <span className="h-edLane">
              <span className="h-edClip h-edClipText" style={{ left: "1%", width: "12%" }} data-fresh={scene.key === "ai" || undefined}>
                Summer nights
              </span>
              <span className="h-edClip h-edClipText" style={{ left: "26%", width: "14%" }} data-peer={scene.key === "team" || undefined}>
                Shibuya, 2 a.m.
                {scene.key === "team" && <span className="h-edBadge">SO</span>}
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
                  data-mika={(s.key === "team" && scene.key === "team") || undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a clip thumbnail in a drawn interface */}
                  <img src={s.poster} alt="" width={64} height={36} />
                  {MEDIA[i].name}
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
          {/* The playhead crosses the scene's own clip over the scene's length. */}
          <span
            key={scene.key}
            className="h-edPlayhead"
            style={{ "--from": active * 25 + 1, "--to": active * 25 + 24, animationDuration: `${scene.ms}ms` } as React.CSSProperties}
          />
        </div>
      </div>
    </section>
  );
}

// The editor's own YouTube Shorts view (lib/editor/platform-views.ts), drawn by its own overlay component.
const SHORTS_VIEW = platformViewsFor({ width: 1080, height: 1920 }).find((v) => v.id === "youtube-shorts") as PlatformView;

// One person's selection: their colour (set by the class), name tag and handles, and their pointer when they are
// the one moving it.
function Selection({ who, className, pointer = false }: { who: string; className: string; pointer?: boolean }) {
  return (
    <span className={className}>
      <span className="h-edPeerTag">{who}</span>
      <span className="h-edHandle" data-at="tl" />
      <span className="h-edHandle" data-at="tr" />
      <span className="h-edHandle" data-at="bl" />
      <span className="h-edHandle" data-at="br" />
      {pointer && (
        <svg className="h-edCursor" viewBox="0 0 16 20" aria-hidden="true">
          <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" />
        </svg>
      )}
    </span>
  );
}

// What lies over the preview in each scene: titles and the selections of whoever is editing them.
function Overlay({ scene }: { scene: string }) {
  return (
    <>
      {scene === "ai" && (
        // Claude adds the title over the group, then moves it up into the dark sky where it reads.
        <span className="h-edTitle h-edTitleNew">
          Summer nights
          <Selection who="Claude" className="h-edClaude" />
        </span>
      )}
      {scene === "team" && (
        <>
          {/* Sam puts the city and the time over the busy middle of the shot. Mika takes the whole clip,
              enlarges it and moves it so the dark sky sits behind the words. Priya changes the font, and Leo
              lifts the title up the sky. */}
          <Selection who="Mika" className="h-edMika" />
          <span className="h-edTitle h-edPeerTitle">
            <span className="h-edFontA">Shibuya, 2 a.m.</span>
            <span className="h-edFontB">Shibuya, 2 a.m.</span>
            <Selection who="Sam" className="h-edSam" />
            <Selection who="Priya" className="h-edPriya" pointer />
            <Selection who="Leo" className="h-edLeo" pointer />
          </span>
        </>
      )}
      {scene === "creators" && (
        // Gone vertical, the title wraps to fit, then View as: YouTube Shorts shows what the app will cover; the
        // title already sits in the part it leaves clear.
        <>
          <span className="h-edTitle h-edShortsTitle">Into the hills</span>
          <span className="h-edShorts">
            <PlatformOverlay view={SHORTS_VIEW} frameShape={9 / 16} />
          </span>
        </>
      )}
    </>
  );
}
