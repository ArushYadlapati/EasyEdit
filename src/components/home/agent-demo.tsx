"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/ui/logo";

// The home page's one live thing: pick a request in plain words and watch a model of the editor change the way an
// agent's edit changes a real project. Each request is one of the connector's real tools (add_text, trim_clip,
// set_format, split_clip) and its Activity line is the app's own wording (summarizeOps in lib/editor/activity.ts).

type Clip = { id: string; name: string; thumb: string; start: number; end: number };
type Doc = { vertical: boolean; title: boolean; video: Clip[] };

const SECONDS = 10; // the timeline's visible length
const PLAYHEAD = 3;

// Stills from Pexels footage (free to use, no credit required).
const DOG = { name: "beach-dog", thumb: "/home/still-dog.jpg" };
const SURF = { name: "surf", thumb: "/home/still-surf.jpg" };

const BASE: Doc = {
  vertical: false,
  title: false,
  video: [
    { id: "a", ...DOG, start: 0, end: 5 },
    { id: "b", ...SURF, start: 5, end: 9 },
  ],
};

type Request = { key: string; agent: string; words: string; summary: string; apply: (d: Doc) => Doc; fresh: string };

export const REQUESTS: Request[] = [
  {
    key: "title",
    agent: "Claude",
    words: "Add a title that says Summer trip.",
    summary: "Added text",
    apply: (d) => ({ ...d, title: true }),
    fresh: "text",
  },
  {
    key: "trim",
    agent: "ChatGPT",
    words: "Make the surf shot two seconds long.",
    summary: "Trimmed a video clip",
    apply: (d) => ({ ...d, video: d.video.map((c) => (c.id === "b" ? { ...c, end: 7 } : c)) }),
    fresh: "b",
  },
  {
    key: "vertical",
    agent: "Codex",
    words: "Make it vertical for Reels and TikTok.",
    summary: "Changed the format to Vertical 9:16",
    apply: (d) => ({ ...d, vertical: true }),
    fresh: "frame",
  },
  {
    key: "split",
    agent: "Cursor",
    words: "Split the beach clip at the playhead.",
    summary: "Split a video clip",
    apply: (d) => ({
      ...d,
      video: d.video.flatMap((c) =>
        c.id === "a" ? [{ ...c, id: "a1", end: PLAYHEAD }, { ...c, id: "a2", start: PLAYHEAD }] : [c],
      ),
    }),
    fresh: "a2",
  },
];

type Phase = "working" | "done" | "undone";
const at = (s: number) => `${(s / SECONDS) * 100}%`;
const time = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

export function AgentDemo() {
  const [chosen, setChosen] = useState(0);
  const [phase, setPhase] = useState<Phase>("done");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const choose = (i: number) => {
    window.clearTimeout(timer.current);
    setChosen(i);
    setPhase("working");
    timer.current = window.setTimeout(() => setPhase("done"), 900);
  };

  const request = REQUESTS[chosen];
  const doc = phase === "done" ? request.apply(BASE) : BASE;
  const fresh = phase === "done" ? request.fresh : null;
  const shown = doc.video.find((c) => c.start <= PLAYHEAD && PLAYHEAD < c.end) ?? doc.video[0];

  return (
    <div className="h-demo">
      <ul className="h-demoRequests" aria-label="Ask an agent">
        {REQUESTS.map((r, i) => (
          <li key={r.key}>
            <button type="button" aria-pressed={i === chosen} onClick={() => choose(i)} className="h-demoRequest">
              <span className="h-demoWords">{r.words}</span>
              <span className="h-demoAgent">Ask {r.agent}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="h-demoStage">
        <figure className="h-demoFigure">
        <div data-ui className="h-ui">
          <div className="h-uiBar">
            <LogoMark size={16} />
            <span className="h-uiProject">Summer trip</span>
            <span className="h-uiStatus">
              {phase === "working" ? (
                <>
                  <span className="h-uiDot" /> {request.agent} is editing…
                </>
              ) : (
                "Saved"
              )}
            </span>
            <span className="h-uiExport">Export</span>
          </div>

          <div className="h-uiMain">
            <div className="h-uiPreview">
              <div className="h-uiFrame" data-vertical={doc.vertical || undefined} data-fresh={fresh === "frame" || undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a fixed still inside a drawn interface */}
                <img src={shown.thumb} alt="" width={960} height={540} />
                {doc.title && (
                  <span className="h-uiTitle" data-fresh={fresh === "text" || undefined}>
                    Summer trip
                  </span>
                )}
              </div>
            </div>

            <div className="h-uiSide">
              <div className="h-uiTabs">
                <span>Inspect</span>
                <span data-on>Activity</span>
              </div>
              <ol className="h-uiActivity">
                {phase !== "working" && (
                  <li key={`${request.key}-${phase}`} data-fresh>
                    <span className="h-uiWho">
                      {request.agent} (for you) · {request.summary}
                    </span>
                    <span className="h-uiWhen">
                      just now
                      <button
                        type="button"
                        className="h-uiUndo"
                        disabled={phase === "undone"}
                        onClick={() => setPhase("undone")}
                      >
                        {phase === "undone" ? "Undone" : "Undo this change"}
                      </button>
                    </span>
                  </li>
                )}
                <li>
                  <span className="h-uiWho">You · Added 2 clips</span>
                  <span className="h-uiWhen">3 minutes ago</span>
                </li>
              </ol>
            </div>
          </div>

          <div className="h-uiTimeline">
            <div className="h-uiRuler">
              {Array.from({ length: SECONDS }, (_, s) => (
                <span key={s} style={{ left: at(s) }}>
                  {time(s)}
                </span>
              ))}
            </div>
            <div className="h-uiTrack">
              <span className="h-uiTrackName">Text 1</span>
              <div className="h-uiLane">
                {doc.title && (
                  <span
                    className="h-uiClip h-uiClipText"
                    style={{ left: at(0), width: at(4) }}
                    data-fresh={fresh === "text" || undefined}
                  >
                    Summer trip
                  </span>
                )}
              </div>
            </div>
            <div className="h-uiTrack">
              <span className="h-uiTrackName">Video 1</span>
              <div className="h-uiLane">
                {doc.video.map((c) => (
                  <span
                    key={c.id}
                    className="h-uiClip"
                    style={{ left: at(c.start), width: at(c.end - c.start) }}
                    data-fresh={fresh === c.id || undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a clip's thumbnail in a drawn interface */}
                    <img src={c.thumb} alt="" width={48} height={27} />
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
            <span className="h-uiPlayhead" style={{ "--at": PLAYHEAD / SECONDS } as React.CSSProperties} />
          </div>
        </div>
        <figcaption className="h-demoNote">
          A working model of the editor. In EasyEdit, you connect your own agent and ask it anything a person could do
          on the timeline.
        </figcaption>
        </figure>
      </div>
    </div>
  );
}
